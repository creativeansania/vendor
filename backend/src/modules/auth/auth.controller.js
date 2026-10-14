import { authService } from './auth.service.js';

export const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const result = await authService.login({ email, password });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleGetMe = async (req, res) => {
  try {
    const user = await authService.getMe(req.user.id);
    return res.status(200).json({ success: true, user });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};
