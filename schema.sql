-- Create Database
CREATE DATABASE IF NOT EXISTS iaa_lost_found;
USE iaa_lost_found;

-- Table: Users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  role ENUM('student', 'staff', 'lecturer', 'security', 'admin') NOT NULL,
  reg_number VARCHAR(50) NULL UNIQUE, -- For students: XXX-01-0000-0000
  details TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: Items
CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  type ENUM('lost', 'found') NOT NULL,
  date_reported DATE NOT NULL,
  location VARCHAR(255) NOT NULL,
  storage VARCHAR(255) NULL,
  description TEXT NOT NULL,
  status ENUM('lost', 'found', 'claimed', 'in_custody', 'handed_over') NOT NULL DEFAULT 'lost',
  reporter_id INT NOT NULL,
  contact VARCHAR(50) NOT NULL,
  image LONGTEXT NULL,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: Claims
CREATE TABLE IF NOT EXISTS claims (
  id VARCHAR(50) PRIMARY KEY,
  item_id VARCHAR(50) NOT NULL,
  claimant_id INT NOT NULL,
  proof TEXT NOT NULL,
  date_claimed DATE NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  officer_remarks TEXT NULL,
  reject_reason VARCHAR(255) NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (claimant_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  message TEXT NOT NULL,
  user_identifier VARCHAR(255) NOT NULL -- Store email or reg_number
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ================= SEED DATA =================

-- Seed Users
-- Passwords are plain text for demo ease. In production, bcrypt hashing is recommended.
INSERT INTO users (id, email, password, name, phone, role, reg_number, details) VALUES
(1, 'admin@iaa.ac.tz', 'admin123', 'System Administrator', '0755990011', 'admin', NULL, 'Admin ID: IAA-ADM-001 | IT Systems Director'),
(2, 'security@iaa.ac.tz', 'security123', 'Sgt. John Peter', '0766112233', 'security', NULL, 'Badge No: IAA-SEC-012 | Gate 1 Shift'),
(3, 'student@iaa.ac.tz', 'student123', 'Sarah Emmanuel', '0752887766', 'student', 'IMC-01-0890-2024', 'Reg No: IMC-01-0890-2024 | Course: BBA Year 1'),
(4, 'lecturer@iaa.ac.tz', 'lecturer123', 'Dr. K. Macha', '0754122345', 'lecturer', NULL, 'Lecturer ID: IAA-LEC-0322 | CIT Faculty'),
(5, 'grace@iaa.ac.tz', 'grace123', 'Grace Mwila', '0788344556', 'staff', NULL, 'Staff ID: IAA-ST-9988 | Cleaner Services'),
(6, 'hamis@iaa.ac.tz', 'hamis123', 'Hamis Juma', '0712345678', 'student', 'HAM-01-0122-2025', 'Reg No: HAM-01-0122-2025 | Course: BBF Year 2');

-- Seed Items
INSERT INTO items (id, title, category, type, date_reported, location, storage, description, status, reporter_id, contact) VALUES
('item_1', 'MacBook Pro M2 Charger', 'electronics', 'found', '2026-07-01', 'Block B Computer Lab (Room 102)', 'CIT Department Desk', 'Apple 67W USB-C power adapter with a slightly worn white cable. Found plugged in next to the windows.', 'found', 4, '0754122345'),
('item_2', 'Samsung Galaxy A54 Phone', 'electronics', 'found', '2026-07-02', 'Main Cafeteria Table', 'Security Gate Office Desk', 'Black Samsung Galaxy A54 with a dark green silicone cover. The lock screen wallpaper has a photo of the IAA gate.', 'claimed', 5, '0788344556'),
('item_3', 'National ID (NIDA) - Juma Hamisi', 'documents', 'found', '2026-07-03', 'Library Reception Desk', 'Library Custody Box', 'NIDA Card for Juma Hamisi. Found lying on the newspaper reading table.', 'found', 2, '0766112233'),
('item_4', 'Dell Inspiron 15 Laptop (Black)', 'electronics', 'lost', '2026-07-04', 'Block C Hallway Bench', '', 'Black Dell Inspiron 15 3000. Has a sticker of \'GitLab\' and \'Developer\' on the back of the screen cover. Contains personal study projects.', 'lost', 6, '0712345678');

-- Seed Claims
INSERT INTO claims (id, item_id, claimant_id, proof, date_claimed, status, officer_remarks, reject_reason) VALUES
('claim_1', 'item_2', 3, 'It is a black Samsung A54 with a green phone cover. The lock screen wallpaper is a picture of the IAA clock tower. It has a tiny scratch on the top-left corner of the screen. I was sitting at the cafeteria table around 1:00 PM.', '2026-07-05', 'pending', '', '');

-- Seed Audit Logs
INSERT INTO audit_logs (id, timestamp, message, user_identifier) VALUES
(1, '2026-07-07 10:00:23', 'MySQL database initialized with default security credentials.', 'admin@iaa.ac.tz'),
(2, '2026-07-07 11:34:02', 'Dr. K. Macha reported found item: MacBook Pro M2 Charger', 'lecturer@iaa.ac.tz'),
(3, '2026-07-07 13:05:44', 'Sarah Emmanuel submitted ownership claim for Samsung Galaxy A54 Phone', 'student@iaa.ac.tz');

-- Table: System Settings
CREATE TABLE IF NOT EXISTS system_settings (
  key_name VARCHAR(100) PRIMARY KEY,
  value_content TEXT NULL,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Settings
INSERT INTO system_settings (key_name, value_content, description) VALUES
('twilio_sid', 'YOUR_TWILIO_ACCOUNT_SID', 'Twilio Account SID credential for SMS gateway'),
('twilio_auth_token', 'YOUR_TWILIO_AUTH_TOKEN', 'Twilio Authentication Token credential for SMS gateway'),
('twilio_from_number', 'YOUR_TWILIO_PHONE_NUMBER', 'Twilio registered phone number with international country code'),
('brevo_api_key', 'YOUR_BREVO_API_KEY', 'Brevo API v3 authorization key for SMTP routing'),
('brevo_sender_name', 'IAA Lost & Found Portal', 'System sender name identifier for transactional emails'),
('brevo_sender_email', 'no-reply@iaa.ac.tz', 'System sender email address identifier');
