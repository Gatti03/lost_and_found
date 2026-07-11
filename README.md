# IAA Portal - Lost & Found System

A comprehensive, responsive, and secure web application designed specifically for the **Institute of Accountancy Arusha (IAA)** to manage lost and found property across campus. 

The system enables students, staff, lecturers, campus security officers, and administrators to coordinate, verify ownership, and resolve cases in real-time.

## 🚀 Key Features

* **Role-Based Access Control**:
  * **Students**: Log in using a strict registration number format (`XXX-01-0000-0000`) to report items and submit ownership claims.
  * **Staff / Lecturers**: Report items and claim personal belongings using staff/lecturer IDs.
  * **Campus Security**: Manage the custody desk, verify proof of ownership, approve/reject claims, and update custody locations.
  * **System Admin**: Manage user accounts, moderate items, view system audit timelines, and print weekly logs.
* **Database-Stored Image Uploads**: Lost reports enforce a mandatory photo upload, which is converted to base64 and stored directly in the MySQL database.
* **Double-Notification Pipeline**: Automatically dispatches alerts via SMS and Email during registration, item reporting, and claim verification. Includes visual browser alerts, database logging, and text-file tracking.
* **Weekly Audit Reports**: Allows administrators to generate and print formatted weekly reports (or export as PDFs) containing logs of all items reported and resolved over the past 7 days.
* **Official Branding**: Custom-designed styling matching the official IAA corporate colors and shield emblem.

## 🛠️ Tech Stack

* **Frontend**: Vanilla HTML5, CSS3 (using custom variables and custom grid system), JavaScript (ES6+, zero-dependency).
* **Dual Backend Support**:
  * **PHP API (`api.php`)**: Lightweight, zero-dependency PHP backend designed for Apache & MySQL (XAMPP).
  * **Node.js Express (`server.js`)**: Modern Express backend utilizing `mysql2` and `nodemailer` (supporting a 10MB payload limit for base64 images).
* **Database**: MySQL.

## 💾 Database Setup

The database schema is pre-seeded with sample users (Admin, Security, Student, and Lecturer) to make testing simple. Refer to `schema.sql` to instantiate the database.
