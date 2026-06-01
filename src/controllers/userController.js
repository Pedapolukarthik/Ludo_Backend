const User = require('../models/User');
const Match = require('../models/Match');

/**
 * @desc    Update user profile (name, avatar)
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateProfile = async (req, res) => {
  const { name, avatar } = req.body;

  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name;
    if (avatar) user.avatar = avatar;

    await user.save();

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        coins: user.coins,
        xp: user.xp,
        level: user.level,
        rank: user.rank,
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
    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ],
      _id: { $ne: req.user._id } // Exclude self
    }).select('name avatar coins level rank');

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
    if (targetId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot add yourself as a friend' });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if already friends or request already exists
    const user = await User.findById(req.user._id);

    if (user.friends.includes(targetId)) {
      return res.status(400).json({ success: false, message: 'You are already friends' });
    }

    if (targetUser.friendRequests.includes(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Friend request already sent' });
    }

    targetUser.friendRequests.push(req.user._id);
    await targetUser.save();

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
    const user = await User.findById(req.user._id);
    const sender = await User.findById(senderId);

    if (!sender) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Remove from requests
    user.friendRequests = user.friendRequests.filter(
      (reqId) => reqId.toString() !== senderId
    );

    // Add to friends
    if (!user.friends.includes(senderId)) {
      user.friends.push(senderId);
    }

    if (!sender.friends.includes(user._id)) {
      sender.friends.push(user._id);
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
    const user = await User.findById(req.user._id);
    const friend = await User.findById(friendId);

    if (!friend) {
      return res.status(404).json({ success: false, message: 'Friend not found' });
    }

    user.friends = user.friends.filter((fId) => fId.toString() !== friendId);
    friend.friends = friend.friends.filter((fId) => fId.toString() !== req.user._id.toString());

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
    const matches = await Match.find({
      'players.user': req.user._id
    }).sort({ createdAt: -1 });

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
