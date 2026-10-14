import { adminService } from './admin.service.js';

export const handleGetUsers = async (req, res) => {
  try {
    const users = await adminService.getUsers();
    return res.status(200).json({ success: true, users });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleCreateUser = async (req, res) => {
  try {
    const { name, email, password, role, vendor_id } = req.body || {};
    const user = await adminService.createUser({ name, email, password, role, vendor_id });
    return res.status(201).json({ success: true, user });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const handleUpdateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await adminService.updateUser(Number(id), req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};
