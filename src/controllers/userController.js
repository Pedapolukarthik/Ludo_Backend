const { Op } = require('sequelize');
const User = require('../models/User');
const Match = require('../models/Match');
const connectDB = require('../config/db');
const sequelize = connectDB.sequelize;

/**
 * @desc    Update user profile (name, avatar)
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateProfile = async (req, res) => {
  const { name, avatar } = req.body;

  try {
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    if (req.body.hasOwnProperty('allowSpectating')) {
      user.allowSpectating = !!req.body.allowSpectating;
    }
    if (req.body.hasOwnProperty('firebaseToken')) {
      user.firebaseToken = req.body.firebaseToken;
    }

    await user.save();

    res.status(200).json({
      success: true,
      user: {
        _id: String(user.id),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        coins: user.coins,
        xp: user.xp,
        level: user.level,
        rank: user.rank,
        allowSpectating: user.allowSpectating,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Search users by name/email
 * @route   GET /api/users/search
 * @access  Private
 */
const searchUsers = async (req, res) => {
  const query = req.query.query;

  if (!query) {
    return res.status(400).json({ success: false, message: 'Query parameter is required' });
  }

  try {
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.like]: `%${query}%` } },
          { email: { [Op.like]: `%${query}%` } }
        ],
        id: { [Op.ne]: req.user.id } // Exclude self
      },
      attributes: ['id', 'name', 'avatar', 'coins', 'level', 'rank']
    });

    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Send Friend Request
 * @route   POST /api/users/friends/request/:id
 * @access  Private
 */
const sendFriendRequest = async (req, res) => {
  const targetId = req.params.id;

  try {
    if (targetId === req.user.id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot add yourself as a friend' });
    }

    const targetUser = await User.findByPk(targetId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if already friends or request already exists
    const user = await User.findByPk(req.user.id);

    const targetIdInt = parseInt(targetId);
    const friendsList = user.friends || [];
    const friendRequestsList = targetUser.friendRequests || [];

    if (friendsList.some(fId => fId.toString() === targetId.toString())) {
      return res.status(400).json({ success: false, message: 'You are already friends' });
    }

    if (friendRequestsList.some(rId => rId.toString() === req.user.id.toString())) {
      return res.status(400).json({ success: false, message: 'Friend request already sent' });
    }

    targetUser.friendRequests = [...friendRequestsList, req.user.id];
    targetUser.changed('friendRequests', true);
    await targetUser.save();

    // Trigger push notification
    const { sendPushNotification } = require('../config/firebase');
    if (targetUser.firebaseToken) {
      sendPushNotification(targetUser.firebaseToken, 'New Friend Request 👥', `${user.name} sent you a friend request!`, { type: 'friend_request', senderId: String(user.id) });
    }

    res.status(200).json({ success: true, message: 'Friend request sent successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Accept Friend Request
 * @route   POST /api/users/friends/accept/:id
 * @access  Private
 */
const acceptFriendRequest = async (req, res) => {
  const senderId = req.params.id;

  try {
    const user = await User.findByPk(req.user.id);
    const sender = await User.findByPk(senderId);

    if (!sender) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const senderIdInt = parseInt(senderId);

    // Remove from requests
    user.friendRequests = (user.friendRequests || []).filter(
      (reqId) => reqId.toString() !== senderId.toString()
    );
    user.changed('friendRequests', true);

    // Add to friends
    const userFriends = user.friends || [];
    if (!userFriends.some((fId) => fId.toString() === senderId.toString())) {
      user.friends = [...userFriends, senderIdInt];
      user.changed('friends', true);
    }

    const senderFriends = sender.friends || [];
    if (!senderFriends.some((fId) => fId.toString() === user.id.toString())) {
      sender.friends = [...senderFriends, user.id];
      sender.changed('friends', true);
    }

    await user.save();
    await sender.save();

    res.status(200).json({ success: true, message: 'Friend request accepted', friends: user.friends });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Remove Friend
 * @route   DELETE /api/users/friends/:id
 * @access  Private
 */
const removeFriend = async (req, res) => {
  const friendId = req.params.id;

  try {
    const user = await User.findByPk(req.user.id);
    const friend = await User.findByPk(friendId);

    if (!friend) {
      return res.status(404).json({ success: false, message: 'Friend not found' });
    }

    user.friends = (user.friends || []).filter((fId) => fId.toString() !== friendId.toString());
    user.changed('friends', true);

    friend.friends = (friend.friends || []).filter((fId) => fId.toString() !== req.user.id.toString());
    friend.changed('friends', true);

    await user.save();
    await friend.save();

    res.status(200).json({ success: true, message: 'Friend removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get current user's match history
 * @route   GET /api/users/match-history
 * @access  Private
 */
const getMatchHistory = async (req, res) => {
  try {
    const matches = await Match.findAll({
      where: sequelize.literal(`JSON_CONTAINS(players, '{"user": ${req.user.id}}')`),
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      matches
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  updateProfile,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  getMatchHistory,
};
