const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// INCREASE BODY SIZE LIMIT to support base64 image uploads!
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'iaa_lost_found',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database successfully!');
    connection.release();
  } catch (error) {
    console.error('❌ Failed to connect to MySQL database:', error.message);
    console.log('👉 Please ensure your MySQL server is running, and credentials in the .env file are correct.');
  }
})();

// Helper function to log audit events in database
async function logEvent(message, userIdentifier) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (message, user_identifier) VALUES (?, ?)',
      [message, userIdentifier]
    );
  } catch (e) {
    console.error("Log insertion failed:", e.message);
  }
}

// Helper to fetch settings from database
async function getSystemSetting(key) {
  try {
    const [rows] = await pool.query('SELECT value_content FROM system_settings WHERE key_name = ?', [key]);
    return rows.length > 0 ? rows[0].value_content : null;
  } catch (e) {
    console.error(`Failed to fetch setting ${key}:`, e.message);
    return null;
  }
}

// Helper to send real SMS via Twilio REST API
async function sendTwilioSMS(to, message) {
  const sid = await getSystemSetting('twilio_sid');
  const token = await getSystemSetting('twilio_auth_token');
  const from = await getSystemSetting('twilio_from_number');
  
  if (!sid || sid === 'YOUR_TWILIO_ACCOUNT_SID') {
    return false;
  }
  
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
      },
      body: new URLSearchParams({
        From: from,
        To: to,
        Body: message
      })
    });
    return await response.json();
  } catch (err) {
    console.error("Twilio SMS dispatch failed:", err.message);
    return false;
  }
}

// Helper to send real email via Brevo REST API (Node fallback if SMTP is offline)
async function sendBrevoEmail(to, subject, message) {
  const apiKey = await getSystemSetting('brevo_api_key');
  const senderName = await getSystemSetting('brevo_sender_name') || 'IAA Lost & Found Portal';
  const senderEmail = await getSystemSetting('brevo_sender_email') || 'no-reply@iaa.ac.tz';

  if (!apiKey || apiKey === 'YOUR_BREVO_API_KEY') {
    return false;
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to }],
        subject: subject,
        textContent: message
      })
    });
    return await response.json();
  } catch (err) {
    console.error("Brevo Email dispatch failed:", err.message);
    return false;
  }
}

async function sendSystemNotification(phone, email, subject, message) {
  try {
    // 1. Log dispatch to database audit timeline
    let recipientStr = "";
    if (phone) recipientStr += `SMS to: ${phone}`;
    if (email) recipientStr += (recipientStr ? " & " : "") + `Email to: ${email}`;
    await logEvent(`[Notification Dispatch] Subj: ${subject} | Msg: ${message}`, recipientStr || 'System Log');

    // 2. Try email dispatch (Brevo REST API fallback to SMTP Nodemailer)
    if (email) {
      const brevoSent = await sendBrevoEmail(email, subject, message);
      if (!brevoSent) {
        // Fallback to standard SMTP Nodemailer
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'localhost',
          port: parseInt(process.env.SMTP_PORT || '1025', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
          },
          tls: { rejectUnauthorized: false }
        });

        const senderEmail = await getSystemSetting('brevo_sender_email') || 'no-reply@iaa.ac.tz';
        transporter.sendMail({
          from: `"IAA Lost & Found Portal" <${senderEmail}>`,
          to: email,
          subject: subject,
          text: message
        }).catch(err => {
          // Silently catch mail dispatch failures
        });
      }
    }

    // 3. Dispatch real SMS (Twilio REST API) & Log offline
    if (phone) {
      await sendTwilioSMS(phone, message);
      
      const smsLogEntry = `${new Date().toISOString().replace('T', ' ').substring(0, 19)} | TO: ${phone} | MSG: ${message}\n`;
      fs.appendFileSync(path.join(__dirname, 'sms_notifications.log'), smsLogEntry);
    }
  } catch (e) {
    console.error("Notification helper failed:", e.message);
  }
}

// Student Registration regex check (Format: XXX-01-0000-0000)
const STUDENT_REG_REGEX = /^[A-Z]{3}-01-\d{4}-\d{4}$/;

// ================= API ENDPOINTS =================

// 1. User Registration
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, phone, role, regNumber, details } = req.body;

  try {
    let emailValue = null;
    let regValue = null;

    if (role === 'student') {
      const regUpper = regNumber.trim().toUpperCase();
      if (!STUDENT_REG_REGEX.test(regUpper)) {
        return res.status(400).json({ 
          error: "Registration Number must follow the strict format: XXX-01-0000-0000 (e.g. IMC-01-0890-2024)" 
        });
      }
      
      const [existingReg] = await pool.query('SELECT id FROM users WHERE reg_number = ?', [regUpper]);
      if (existingReg.length > 0) {
        return res.status(400).json({ error: "This Registration Number is already registered." });
      }
      regValue = regUpper;
    } else {
      const emailLower = email.trim().toLowerCase();
      const [existingEmail] = await pool.query('SELECT id FROM users WHERE email = ?', [emailLower]);
      if (existingEmail.length > 0) {
        return res.status(400).json({ error: "This email address is already registered." });
      }
      emailValue = emailLower;
    }

    const [result] = await pool.query(
      'INSERT INTO users (email, password, name, phone, role, reg_number, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [emailValue, password, name, phone, role, regValue, details]
    );

    const userIdentifier = role === 'student' ? regValue : emailValue;
    await logEvent(`Registered new account with role: ${role}`, userIdentifier);

    // Send notifications
    const subject = "IAA Lost & Found - Account Registered";
    const body = `Hello ${name}, your IAA Lost & Found Portal account has been successfully created. Role: ${role.toUpperCase()}.`;
    await sendSystemNotification(phone, emailValue || email, subject, body);

    res.status(201).json({
      message: "Account registered successfully!",
      user: {
        id: result.insertId,
        email: emailValue,
        name,
        phone,
        role,
        reg_number: regValue,
        details
      },
      notification: {
        email: emailValue || email,
        phone,
        subject,
        body
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration database query failed." });
  }
});

// 2. User Login
app.post('/api/auth/login', async (req, res) => {
  const { loginId, password } = req.body;
  const searchId = loginId.trim();

  try {
    let rows;
    if (STUDENT_REG_REGEX.test(searchId.toUpperCase())) {
      [rows] = await pool.query(
        'SELECT * FROM users WHERE reg_number = ? AND password = ?',
        [searchId.toUpperCase(), password]
      );
    } else {
      [rows] = await pool.query(
        'SELECT * FROM users WHERE email = ? AND password = ?',
        [searchId.toLowerCase(), password]
      );
    }

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials. Please verify your ID/Email and password." });
    }

    const user = rows[0];
    const userIdentifier = user.role === 'student' ? user.reg_number : user.email;
    await logEvent('User logged into system', userIdentifier);

    res.json({
      message: "Success login!",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        reg_number: user.reg_number,
        details: user.details
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login database query failed." });
  }
});

// 3. Get Items / Post Items
app.get('/api/items', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT items.*, users.name as reporter_name, users.role as reporter_role, users.details as reporter_details 
       FROM items 
       JOIN users ON items.reporter_id = users.id 
       ORDER BY items.date_reported DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve items registry." });
  }
});

app.post('/api/items', async (req, res) => {
  const { title, category, type, date, location, storage, desc, reporterId, contact, image } = req.body;
  const itemId = 'item_' + Date.now();
  const status = type === 'found' ? 'found' : 'lost';

  try {
    await pool.query(
      `INSERT INTO items (id, title, category, type, date_reported, location, storage, description, status, reporter_id, contact, image) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, title, category, type, date, location, storage, desc, status, reporterId, contact, image || null]
    );

    const [userRow] = await pool.query('SELECT name, email, reg_number, phone FROM users WHERE id = ?', [reporterId]);
    const userIdentifier = userRow.length > 0 ? (userRow[0].reg_number || userRow[0].email) : 'Unknown';
    await logEvent(`Reported new ${type} item: ${title}`, userIdentifier);

    // Send notifications
    let subject = "";
    let body = "";
    if (userRow.length > 0) {
      subject = `IAA Lost & Found - Item Reported (${type})`;
      body = `Hello ${userRow[0].name}, your report for the item '${title}' has been published successfully on the portal.`;
      await sendSystemNotification(userRow[0].phone, userRow[0].email || userIdentifier, subject, body);
    }

    res.status(201).json({
      message: "Item reported successfully!",
      itemId,
      notification: {
        email: userRow.length > 0 ? (userRow[0].email || userIdentifier) : '',
        phone: userRow.length > 0 ? userRow[0].phone : '',
        subject,
        body
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create item registry." });
  }
});

// 4. Update Item Custody & Status
app.post('/api/items/:id/status', async (req, res) => {
  const itemId = req.params.id;
  const { status, storage, actorEmail } = req.body;

  try {
    if (status !== undefined && storage !== undefined) {
      await pool.query('UPDATE items SET status = ?, storage = ? WHERE id = ?', [status, storage, itemId]);
    } else if (status !== undefined) {
      await pool.query('UPDATE items SET status = ? WHERE id = ?', [status, itemId]);
    } else if (storage !== undefined) {
      await pool.query('UPDATE items SET storage = ? WHERE id = ?', [storage, itemId]);
    }

    const [itemRow] = await pool.query('SELECT title FROM items WHERE id = ?', [itemId]);
    const title = itemRow.length > 0 ? itemRow[0].title : itemId;

    if (status !== undefined) await logEvent(`Changed item status for (${title}) to ${status.toUpperCase()}`, actorEmail);
    if (storage !== undefined) await logEvent(`Updated custody desk for item (${title}) to ${storage}`, actorEmail);

    res.json({ message: "Item updated successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update item status." });
  }
});

// 5. Get Claims / Create Claim
app.get('/api/claims', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT claims.*, items.title as item_title, items.storage as item_storage, items.reporter_id as founder_id, 
              founder.name as founder_name, claimant.name as claimant_name, claimant.role as claimant_role, 
              claimant.details as claimant_details 
       FROM claims 
       JOIN items ON claims.item_id = items.id 
       JOIN users claimant ON claims.claimant_id = claimant.id 
       JOIN users founder ON items.reporter_id = founder.id`
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve claims registry." });
  }
});

app.post('/api/claims', async (req, res) => {
  const { itemId, claimantId, proof, actorEmail } = req.body;
  const claimId = 'claim_' + Date.now();
  const claimDate = new Date().toISOString().split('T')[0];

  try {
    // Insert claim
    await pool.query(
      'INSERT INTO claims (id, item_id, claimant_id, proof, date_claimed, status) VALUES (?, ?, ?, ?, ?, ?)',
      [claimId, itemId, claimantId, proof, claimDate, 'pending']
    );

    // Update item status
    await pool.query('UPDATE items SET status = ? WHERE id = ?', ['claimed', itemId]);

    const [itemRow] = await pool.query('SELECT title, reporter_id FROM items WHERE id = ?', [itemId]);
    const title = itemRow.length > 0 ? itemRow[0].title : itemId;

    await logEvent(`Submitted claim for item: ${title}`, actorEmail);

    // Fetch claimant details
    const [claimantRows] = await pool.query('SELECT name, email, reg_number, phone FROM users WHERE id = ?', [claimantId]);
    const claimant = claimantRows[0];

    let claimantSubj = "Claim Submitted";
    let claimantBody = "";
    if (claimant) {
      claimantSubj = "IAA Lost & Found - Claim Submitted";
      claimantBody = `Hello ${claimant.name}, your ownership claim request for the item '${title}' has been received. Security will verify it shortly.`;
      await sendSystemNotification(claimant.phone, claimant.email || claimant.reg_number || actorEmail, claimantSubj, claimantBody);
    }

    // Fetch founder details
    let founderSubj = "";
    let founderBody = "";
    if (itemRow.length > 0) {
      const [founderRows] = await pool.query('SELECT name, email, reg_number, phone FROM users WHERE id = ?', [itemRow[0].reporter_id]);
      const founder = founderRows[0];
      if (founder) {
        founderSubj = "IAA Lost & Found - Claim Filed for Your Post";
        founderBody = `Hello ${founder.name}, an ownership claim has been submitted for the item '${title}' you reported. Campus Security will verify it.`;
        await sendSystemNotification(founder.phone, founder.email || founder.reg_number, founderSubj, founderBody);
      }
    }

    res.status(201).json({
      message: "Claim submitted successfully!",
      claimId,
      notifications: [
        {
          recipient: claimant ? claimant.name : 'Claimant',
          email: claimant ? (claimant.email || claimant.reg_number || actorEmail) : '',
          phone: claimant ? claimant.phone : '',
          subject: claimantSubj,
          body: claimantBody
        },
        {
          recipient: (itemRow.length > 0 && founderRows && founderRows[0]) ? founderRows[0].name : 'Founder',
          email: (itemRow.length > 0 && founderRows && founderRows[0]) ? (founderRows[0].email || founderRows[0].reg_number) : '',
          phone: (itemRow.length > 0 && founderRows && founderRows[0]) ? founderRows[0].phone : '',
          subject: founderSubj,
          body: founderBody
        }
      ]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to file claim record." });
  }
});

// 6. Verify Ownership Claim (Approve/Reject)
app.post('/api/claims/:id/verify', async (req, res) => {
  const claimId = req.params.id;
  const { status, remarks, reason, actorEmail } = req.body;

  try {
    const [claimRows] = await pool.query('SELECT * FROM claims WHERE id = ?', [claimId]);
    if (claimRows.length === 0) {
      return res.status(404).json({ error: "Claim verification request not found" });
    }
    const claim = claimRows[0];
    const itemId = claim.item_id;

    // Update claim
    await pool.query(
      'UPDATE claims SET status = ?, officer_remarks = ?, reject_reason = ? WHERE id = ?',
      [status, remarks, reason || null, claimId]
    );

    // Update item
    const finalItemStatus = status === 'approved' ? 'handed_over' : 'found';
    await pool.query('UPDATE items SET status = ? WHERE id = ?', [finalItemStatus, itemId]);

    const [itemRow] = await pool.query('SELECT title FROM items WHERE id = ?', [itemId]);
    const title = itemRow.length > 0 ? itemRow[0].title : itemId;

    const [claimantRows] = await pool.query('SELECT name, email, reg_number, phone FROM users WHERE id = ?', [claim.claimant_id]);
    const claimant = claimantRows[0];

    let subj = `IAA Lost & Found - Claim ${status.toUpperCase()}`;
    let msg = "";
    if (claimant) {
      msg = `Hello ${claimant.name}, your claim for '${title}' has been ${status.toUpperCase()} by Security.`;
      if (status === 'approved') {
        msg += ` Remarks: ${remarks}. You can collect your item at the custody desk.`;
      } else {
        msg += ` Reason: ${reason}. Remarks: ${remarks}.`;
      }
      await sendSystemNotification(claimant.phone, claimant.email || claimant.reg_number, subj, msg);
    }

    if (status === 'approved') {
      await logEvent(`Approved claim for item (${title}) by claimant ${claimant ? claimant.name : 'Claimant'}`, actorEmail);
    } else {
      await logEvent(`Rejected claim for item (${title}) for reason: ${reason}`, actorEmail);
    }

    res.json({
      message: `Claim verification processed as: ${status.toUpperCase()}`,
      notification: {
        email: claimant ? (claimant.email || claimant.reg_number) : '',
        phone: claimant ? claimant.phone : '',
        subject: subj,
        body: msg
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to verify ownership claim." });
  }
});

// 7. Admin: Get Users
app.get('/api/admin/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, email, name, phone, role, reg_number, details FROM users');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve user directory." });
  }
});

// 8. Admin: Update User Role
app.post('/api/admin/users/:id/role', async (req, res) => {
  const userId = req.params.id;
  const { role, details, actorEmail } = req.body;

  try {
    const [userRows] = await pool.query('SELECT name, role FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userRows[0];

    await pool.query('UPDATE users SET role = ?, details = ? WHERE id = ?', [role, details, userId]);
    await logEvent(`Promoted user ${user.name} role from ${user.role.toUpperCase()} to ${role.toUpperCase()}`, actorEmail);

    res.json({ message: "User role updated successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to promote user role." });
  }
});

// 9. Admin: Delete User
app.post('/api/admin/users/:id', async (req, res) => {
  const userId = req.params.id;
  const { actorEmail } = req.body;

  try {
    const [userRows] = await pool.query('SELECT name, email, reg_number FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userRows[0];
    const userIdentifier = user.reg_number || user.email;

    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    await logEvent(`Deleted user account: ${user.name} (${userIdentifier})`, actorEmail);

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete user account." });
  }
});

// 10. Admin: Delete Item Override
app.post('/api/admin/items/:id', async (req, res) => {
  const itemId = req.params.id;
  const { actorEmail } = req.body;

  try {
    const [itemRows] = await pool.query('SELECT title FROM items WHERE id = ?', [itemId]);
    if (itemRows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }
    const title = itemRows[0].title;

    await pool.query('DELETE FROM items WHERE id = ?', [itemId]);
    await logEvent(`Deleted item (${title}) via Admin override.`, actorEmail);

    res.json({ message: "Item deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete item record." });
  }
});

// 11. Get System Audit Logs / Clear Audit logs
app.get('/api/logs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to retrieve logs timeline." });
  }
});

app.delete('/api/logs', async (req, res) => {
  const { actorEmail } = req.body;
  try {
    await pool.query('DELETE FROM audit_logs');
    await logEvent('Cleared audit timeline logs database.', actorEmail);
    res.json({ message: "Audit logs cleared successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to clear timeline logs." });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Express API server is running on http://localhost:${PORT}`);
});
