const express = require('express');
const router = express.Router();
const {
  updateProfile,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend
} = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');

router.put('/profile', protect, updateProfile);
router.get('/search', protect, searchUsers);
router.post('/friends/request/:id', protect, sendFriendRequest);
router.post('/friends/accept/:id', protect, acceptFriendRequest);
router.delete('/friends/:id', protect, removeFriend);

module.exports = router;
