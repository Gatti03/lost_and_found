<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Database Credentials
$host = 'localhost';
$db   = 'iaa_lost_found';
$user = 'root';
$pass = '';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
     $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
     echo json_encode(["error" => "Database connection failed: " . $e->getMessage()]);
     exit;
}

// Helper to log administrative audit logs
function logEvent($pdo, $message, $userIdentifier) {
    try {
        $stmt = $pdo->prepare('INSERT INTO audit_logs (message, user_identifier) VALUES (?, ?)');
        $stmt->execute([$message, $userIdentifier]);
    } catch (Exception $e) {
        // Silently fail logging
    }
}

// Helper to fetch settings from database
function getSystemSetting($pdo, $key) {
    try {
        $stmt = $pdo->prepare('SELECT value_content FROM system_settings WHERE key_name = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        return $row ? $row['value_content'] : null;
    } catch (Exception $e) {
        return null;
    }
}

// Dispatcher: Send SMS via Twilio REST API (HTTP POST curl)
function sendTwilioSMS($pdo, $to, $message) {
    $sid = getSystemSetting($pdo, 'twilio_sid');
    $token = getSystemSetting($pdo, 'twilio_auth_token');
    $from = getSystemSetting($pdo, 'twilio_from_number');
    
    if (!$sid || $sid === 'YOUR_TWILIO_ACCOUNT_SID') {
        return false;
    }
    
    $url = "https://api.twilio.com/2010-04-01/Accounts/$sid/Messages.json";
    $data = [
        'From' => $from,
        'To' => $to,
        'Body' => $message
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
    curl_setopt($ch, CURLOPT_USERPWD, "$sid:$token");
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For local XAMPP SSL bypass
    
    $response = curl_exec($ch);
    curl_close($ch);
    return $response;
}

// Dispatcher: Send Email via Brevo REST API (HTTP POST JSON curl)
function sendBrevoEmail($pdo, $to, $subject, $message) {
    $apiKey = getSystemSetting($pdo, 'brevo_api_key');
    $senderName = getSystemSetting($pdo, 'brevo_sender_name') ?: 'IAA Lost & Found Portal';
    $senderEmail = getSystemSetting($pdo, 'brevo_sender_email') ?: 'no-reply@iaa.ac.tz';
    
    if (!$apiKey || $apiKey === 'YOUR_BREVO_API_KEY') {
        return false;
    }
    
    $url = "https://api.brevo.com/v3/smtp/email";
    $data = [
        "sender" => ["name" => $senderName, "email" => $senderEmail],
        "to" => [["email" => $to]],
        "subject" => $subject,
        "textContent" => $message
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "api-key: $apiKey",
        "Content-Type: application/json"
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For local XAMPP SSL bypass
    
    $response = curl_exec($ch);
    curl_close($ch);
    return $response;
}

// Helper to simulate and send system notifications (Email & SMS log)
function sendSystemNotification($pdo, $phone, $email, $subject, $message) {
    try {
        // 1. Log dispatch to database audit log timeline
        $recipientStr = "";
        if ($phone) $recipientStr .= "SMS to: $phone";
        if ($email) $recipientStr .= ($recipientStr ? " & " : "") . "Email to: $email";
        logEvent($pdo, "[Notification Dispatch] Subj: $subject | Msg: $message", $recipientStr ?: 'System Log');
        
        // 2. Dispatch real Email (Brevo REST API with PHP native mail fallback)
        if ($email) {
            $brevoSent = sendBrevoEmail($pdo, $email, $subject, $message);
            if (!$brevoSent) {
                // Fallback to PHP native mail()
                $senderEmail = getSystemSetting($pdo, 'brevo_sender_email') ?: 'no-reply@iaa.ac.tz';
                $headers = "From: $senderEmail\r\n" .
                           "Reply-To: $senderEmail\r\n" .
                           "X-Mailer: PHP/" . phpversion();
                @mail($email, $subject, $message, $headers);
            }
        }
        
        // 3. Dispatch real SMS (Twilio REST API)
        if ($phone) {
            sendTwilioSMS($pdo, $phone, $message);
            
            // Backup log write
            $smsLogEntry = date('Y-m-d H:i:s') . " | TO: $phone | MSG: $message\n";
            @file_put_contents(__DIR__ . '/sms_notifications.log', $smsLogEntry, FILE_APPEND);
        }
    } catch (Exception $e) {
        // Fail silently
    }
}

// Student Registration Regex check
$STUDENT_REG_REGEX = '/^[A-Z]{3}-01-\d{4}-\d{4}$/';

$action = isset($_GET['action']) ? $_GET['action'] : '';

// Parse JSON input
$input = json_decode(file_get_contents('php://input'), true);

try {
    switch ($action) {
        
        // 1. User Registration
        case 'register':
            $email = isset($input['email']) ? trim($input['email']) : '';
            $password = isset($input['password']) ? $input['password'] : '';
            $name = isset($input['name']) ? trim($input['name']) : '';
            $phone = isset($input['phone']) ? trim($input['phone']) : '';
            $role = isset($input['role']) ? $input['role'] : '';
            $regNumber = isset($input['regNumber']) ? trim($input['regNumber']) : '';
            $details = isset($input['details']) ? trim($input['details']) : '';
            
            if ($role === 'student') {
                $regUpper = strtoupper($regNumber);
                if (!preg_match($STUDENT_REG_REGEX, $regUpper)) {
                    http_response_code(400);
                    echo json_encode(["error" => "Registration Number must follow formatting: XXX-01-0000-0000 (e.g. IMC-01-0890-2024)"]);
                    break;
                }
                
                $stmt = $pdo->prepare('SELECT id FROM users WHERE reg_number = ?');
                $stmt->execute([$regUpper]);
                if ($stmt->fetch()) {
                    http_response_code(400);
                    echo json_encode(["error" => "This Registration Number is already registered."]);
                    break;
                }
                $emailValue = null;
                $regValue = $regUpper;
            } else {
                $emailLower = strtolower($email);
                $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
                $stmt->execute([$emailLower]);
                if ($stmt->fetch()) {
                    http_response_code(400);
                    echo json_encode(["error" => "This email address is already registered."]);
                    break;
                }
                $emailValue = $emailLower;
                $regValue = null;
            }
            
            $stmt = $pdo->prepare('INSERT INTO users (email, password, name, phone, role, reg_number, details) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$emailValue, $password, $name, $phone, $role, $regValue, $details]);
            
            $userId = $pdo->lastInsertId();
            $userIdentifier = $role === 'student' ? $regValue : $emailValue;
            logEvent($pdo, "Registered new account with role: $role", $userIdentifier);
            
            // Dispatch notification
            $subj = "IAA Lost & Found - Account Registered";
            $msg = "Hello $name, your IAA Lost & Found Portal account has been successfully created. Role: " . strtoupper($role) . ".";
            sendSystemNotification($pdo, $phone, $emailValue ?: $email, $subj, $msg);
            
            echo json_encode([
                "message" => "Account registered successfully!",
                "user" => [
                    "id" => $userId,
                    "email" => $emailValue,
                    "name" => $name,
                    "phone" => $phone,
                    "role" => $role,
                    "reg_number" => $regValue,
                    "details" => $details
                ],
                "notification" => [
                    "email" => $emailValue ?: $email,
                    "phone" => $phone,
                    "subject" => $subj,
                    "body" => $msg
                ]
            ]);
            break;

        // 2. User Login
        case 'login':
            $loginId = isset($input['loginId']) ? trim($input['loginId']) : '';
            $password = isset($input['password']) ? $input['password'] : '';
            
            $searchId = strtoupper($loginId);
            if (preg_match($STUDENT_REG_REGEX, $searchId)) {
                $stmt = $pdo->prepare('SELECT * FROM users WHERE reg_number = ? AND password = ?');
                $stmt->execute([$searchId, $password]);
            } else {
                $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? AND password = ?');
                $stmt->execute([strtolower($loginId), $password]);
            }
            
            $user = $stmt->fetch();
            if (!$user) {
                http_response_code(401);
                echo json_encode(["error" => "Invalid credentials. Please verify your ID/Email and password."]);
                break;
            }
            
            $userIdentifier = $user['role'] === 'student' ? $user['reg_number'] : $user['email'];
            logEvent($pdo, 'User logged into system', $userIdentifier);
            
            echo json_encode([
                "message" => "Success login!",
                "user" => [
                    "id" => $user['id'],
                    "email" => $user['email'],
                    "name" => $user['name'],
                    "phone" => $user['phone'],
                    "role" => $user['role'],
                    "reg_number" => $user['reg_number'],
                    "details" => $user['details']
                ]
            ]);
            break;

        // 3. Get Items Registry / Post Items
        case 'items':
            if ($_SERVER['REQUEST_METHOD'] === 'GET') {
                $stmt = $pdo->query('SELECT items.*, users.name as reporter_name, users.role as reporter_role, users.details as reporter_details FROM items JOIN users ON items.reporter_id = users.id ORDER BY items.date_reported DESC');
                echo json_encode($stmt->fetchAll());
            } else if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                $title = $input['title'];
                $category = $input['category'];
                $type = $input['type'];
                $date = $input['date'];
                $location = $input['location'];
                $storage = isset($input['storage']) ? $input['storage'] : '';
                $desc = $input['desc'];
                $reporterId = $input['reporterId'];
                $contact = $input['contact'];
                $image = isset($input['image']) ? $input['image'] : null;
                
                $itemId = 'item_' . round(microtime(true) * 1000);
                $status = $type === 'found' ? 'found' : 'lost';
                
                $stmt = $pdo->prepare('INSERT INTO items (id, title, category, type, date_reported, location, storage, description, status, reporter_id, contact, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([$itemId, $title, $category, $type, $date, $location, $storage, $desc, $status, $reporterId, $contact, $image]);
                
                $uStmt = $pdo->prepare('SELECT name, email, reg_number, phone FROM users WHERE id = ?');
                $uStmt->execute([$reporterId]);
                $userRow = $uStmt->fetch();
                $userIdentifier = $userRow ? ($userRow['reg_number'] ?: $userRow['email']) : 'Unknown';
                
                logEvent($pdo, "Reported new $type item: $title", $userIdentifier);
                
                // Dispatch notification to the reporter
                if ($userRow) {
                    $subj = "IAA Lost & Found - Item Reported ($type)";
                    $msg = "Hello {$userRow['name']}, your report for the item '$title' has been published successfully on the portal.";
                    sendSystemNotification($pdo, $userRow['phone'], $userRow['email'] ?: $userIdentifier, $subj, $msg);
                }
                
                echo json_encode([
                    "message" => "Item reported successfully!",
                    "itemId" => $itemId,
                    "notification" => [
                        "email" => $userRow ? ($userRow['email'] ?: $userIdentifier) : '',
                        "phone" => $userRow ? $userRow['phone'] : '',
                        "subject" => $subj,
                        "body" => $msg
                    ]
                ]);
            }
            break;

        // 4. Update Item Status
        case 'update_item_status':
            $itemId = isset($_GET['id']) ? $_GET['id'] : '';
            $status = isset($input['status']) ? $input['status'] : null;
            $storage = isset($input['storage']) ? $input['storage'] : null;
            $actorEmail = isset($input['actorEmail']) ? $input['actorEmail'] : 'Admin';
            
            if ($status !== null && $storage !== null) {
                $stmt = $pdo->prepare('UPDATE items SET status = ?, storage = ? WHERE id = ?');
                $stmt->execute([$status, $storage, $itemId]);
            } else if ($status !== null) {
                $stmt = $pdo->prepare('UPDATE items SET status = ? WHERE id = ?');
                $stmt->execute([$status, $itemId]);
            } else if ($storage !== null) {
                $stmt = $pdo->prepare('UPDATE items SET storage = ? WHERE id = ?');
                $stmt->execute([$storage, $itemId]);
            }
            
            $stmt = $pdo->prepare('SELECT title FROM items WHERE id = ?');
            $stmt->execute([$itemId]);
            $item = $stmt->fetch();
            $title = $item ? $item['title'] : $itemId;
            
            if ($status !== null) logEvent($pdo, "Changed item status for ($title) to " . strtoupper($status), $actorEmail);
            if ($storage !== null) logEvent($pdo, "Updated custody desk for item ($title) to $storage", $actorEmail);
            
            echo json_encode(["message" => "Item updated successfully!"]);
            break;

        // 5. Get Claims / Post Claim
        case 'claims':
            if ($_SERVER['REQUEST_METHOD'] === 'GET') {
                $stmt = $pdo->query('SELECT claims.*, items.title as item_title, items.storage as item_storage, items.reporter_id as founder_id, founder.name as founder_name, claimant.name as claimant_name, claimant.role as claimant_role, claimant.details as claimant_details FROM claims JOIN items ON claims.item_id = items.id JOIN users claimant ON claims.claimant_id = claimant.id JOIN users founder ON items.reporter_id = founder.id');
                echo json_encode($stmt->fetchAll());
            } else if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                $itemId = $input['itemId'];
                $claimantId = $input['claimantId'];
                $proof = $input['proof'];
                $actorEmail = $input['actorEmail'];
                
                $claimId = 'claim_' . round(microtime(true) * 1000);
                $claimDate = date('Y-m-d');
                
                $stmt = $pdo->prepare('INSERT INTO claims (id, item_id, claimant_id, proof, date_claimed, status) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([$claimId, $itemId, $claimantId, $proof, $claimDate, 'pending']);
                
                $stmt = $pdo->prepare('UPDATE items SET status = ? WHERE id = ?');
                $stmt->execute(['claimed', $itemId]);
                
                $stmt = $pdo->prepare('SELECT title, reporter_id FROM items WHERE id = ?');
                $stmt->execute([$itemId]);
                $item = $stmt->fetch();
                $title = $item ? $item['title'] : $itemId;
                
                logEvent($pdo, "Submitted claim for item: $title", $actorEmail);
                
                // Fetch claimant details
                $cStmt = $pdo->prepare('SELECT name, email, reg_number, phone FROM users WHERE id = ?');
                $cStmt->execute([$claimantId]);
                $claimantRow = $cStmt->fetch();
                
                // Notify Claimant
                if ($claimantRow) {
                    $subj = "IAA Lost & Found - Claim Submitted";
                    $msg = "Hello {$claimantRow['name']}, your ownership claim request for the item '$title' has been received. Security will verify it shortly.";
                    sendSystemNotification($pdo, $claimantRow['phone'], $claimantRow['email'] ?: ($claimantRow['reg_number'] ?: $actorEmail), $subj, $msg);
                }
                
                // Fetch founder/reporter details of the item
                if ($item) {
                    $fStmt = $pdo->prepare('SELECT name, email, reg_number, phone FROM users WHERE id = ?');
                    $fStmt->execute([$item['reporter_id']]);
                    $founderRow = $fStmt->fetch();
                    
                    // Notify Founder
                    if ($founderRow) {
                        $subj = "IAA Lost & Found - Claim Filed for Your Post";
                        $msg = "Hello {$founderRow['name']}, an ownership claim has been submitted for the item '$title' you reported. Campus Security will verify it.";
                        sendSystemNotification($pdo, $founderRow['phone'], $founderRow['email'] ?: $founderRow['reg_number'], $subj, $msg);
                    }
                }
                
                echo json_encode([
                    "message" => "Claim submitted successfully!",
                    "claimId" => $claimId,
                    "notifications" => [
                        [
                            "recipient" => $claimantRow ? $claimantRow['name'] : 'Claimant',
                            "email" => $claimantRow ? ($claimantRow['email'] ?: ($claimantRow['reg_number'] ?: $actorEmail)) : '',
                            "phone" => $claimantRow ? $claimantRow['phone'] : '',
                            "subject" => "Claim Submitted",
                            "body" => "Hello " . ($claimantRow ? $claimantRow['name'] : '') . ", your ownership claim request for the item '$title' has been received. Security will verify it shortly."
                        ],
                        [
                            "recipient" => (isset($founderRow) && $founderRow) ? $founderRow['name'] : 'Founder',
                            "email" => (isset($founderRow) && $founderRow) ? ($founderRow['email'] ?: $founderRow['reg_number']) : '',
                            "phone" => (isset($founderRow) && $founderRow) ? $founderRow['phone'] : '',
                            "subject" => "Claim Filed for Your Post",
                            "body" => (isset($founderRow) && $founderRow) ? "Hello {$founderRow['name']}, an ownership claim has been submitted for the item '$title' you reported. Campus Security will verify it." : ''
                        ]
                    ]
                ]);
            }
            break;

        // 6. Verify Ownership Claim (Approve/Reject)
        case 'verify_claim':
            $claimId = isset($_GET['id']) ? $_GET['id'] : '';
            $status = $input['status'];
            $remarks = isset($input['remarks']) ? $input['remarks'] : '';
            $reason = isset($input['reason']) ? $input['reason'] : '';
            $actorEmail = $input['actorEmail'];
            
            $stmt = $pdo->prepare('SELECT * FROM claims WHERE id = ?');
            $stmt->execute([$claimId]);
            $claim = $stmt->fetch();
            if (!$claim) {
                http_response_code(404);
                echo json_encode(["error" => "Claim verification request not found"]);
                break;
            }
            
            $itemId = $claim['item_id'];
            
            $stmt = $pdo->prepare('UPDATE claims SET status = ?, officer_remarks = ?, reject_reason = ? WHERE id = ?');
            $stmt->execute([$status, $remarks, $reason, $claimId]);
            
            $finalItemStatus = $status === 'approved' ? 'handed_over' : 'found';
            $stmt = $pdo->prepare('UPDATE items SET status = ? WHERE id = ?');
            $stmt->execute([$finalItemStatus, $itemId]);
            
            $stmt = $pdo->prepare('SELECT title FROM items WHERE id = ?');
            $stmt->execute([$itemId]);
            $item = $stmt->fetch();
            $title = $item ? $item['title'] : $itemId;
            
            // Fetch claimant details to notify them
            $cStmt = $pdo->prepare('SELECT name, email, reg_number, phone FROM users WHERE id = ?');
            $cStmt->execute([$claim['claimant_id']]);
            $claimantRow = $cStmt->fetch();
            
            if ($claimantRow) {
                $subj = "IAA Lost & Found - Claim " . strtoupper($status);
                $msg = "Hello {$claimantRow['name']}, your claim for '$title' has been " . strtoupper($status) . " by Security.";
                if ($status === 'approved') {
                    $msg .= " Remarks: $remarks. You can collect your item at the custody desk.";
                } else {
                    $msg .= " Reason: $reason. Remarks: $remarks.";
                }
                sendSystemNotification($pdo, $claimantRow['phone'], $claimantRow['email'] ?: $claimantRow['reg_number'], $subj, $msg);
            }
            
            $stmt = $pdo->prepare('SELECT name FROM users WHERE id = ?');
            $stmt->execute([$claim['claimant_id']]);
            $claimant = $stmt->fetch();
            $claimantName = $claimant ? $claimant['name'] : 'Claimant';
            
            if ($status === 'approved') {
                logEvent($pdo, "Approved claim for item ($title) by claimant $claimantName", $actorEmail);
            } else {
                logEvent($pdo, "Rejected claim for item ($title) for reason: $reason", $actorEmail);
            }
            
            echo json_encode([
                "message" => "Claim verification processed as: " . strtoupper($status),
                "notification" => [
                    "email" => $claimantRow ? ($claimantRow['email'] ?: $claimantRow['reg_number']) : '',
                    "phone" => $claimantRow ? $claimantRow['phone'] : '',
                    "subject" => $subj,
                    "body" => $msg
                ]
            ]);
            break;

        // 7. Admin: Get Users
        case 'admin_users':
            $stmt = $pdo->query('SELECT id, email, name, phone, role, reg_number, details FROM users');
            echo json_encode($stmt->fetchAll());
            break;

        // 8. Admin: Update User Role
        case 'admin_update_role':
            $userId = isset($_GET['id']) ? $_GET['id'] : '';
            $newRole = $input['role'];
            $details = $input['details'];
            $actorEmail = $input['actorEmail'];
            
            $stmt = $pdo->prepare('SELECT name, role FROM users WHERE id = ?');
            $stmt->execute([$userId]);
            $user = $stmt->fetch();
            if (!$user) {
                http_response_code(404);
                echo json_encode(["error" => "User not found"]);
                break;
            }
            
            $stmt = $pdo->prepare('UPDATE users SET role = ?, details = ? WHERE id = ?');
            $stmt->execute([$newRole, $details, $userId]);
            
            logEvent($pdo, "Promoted user {$user['name']} role from " . strtoupper($user['role']) . " to " . strtoupper($newRole), $actorEmail);
            echo json_encode(["message" => "User role updated successfully!"]);
            break;

        // 9. Admin: Delete User
        case 'admin_delete_user':
            $userId = isset($_GET['id']) ? $_GET['id'] : '';
            $actorEmail = isset($input['actorEmail']) ? $input['actorEmail'] : 'Admin';
            
            $stmt = $pdo->prepare('SELECT name, email, reg_number FROM users WHERE id = ?');
            $stmt->execute([$userId]);
            $user = $stmt->fetch();
            if (!$user) {
                http_response_code(404);
                echo json_encode(["error" => "User not found"]);
                break;
            }
            
            $userIdentifier = $user['reg_number'] ?: $user['email'];
            $stmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
            $stmt->execute([$userId]);
            
            logEvent($pdo, "Deleted user account: {$user['name']} ($userIdentifier)", $actorEmail);
            echo json_encode(["message" => "User deleted successfully"]);
            break;

        // 10. Admin: Delete Item
        case 'admin_delete_item':
            $itemId = isset($_GET['id']) ? $_GET['id'] : '';
            $actorEmail = isset($input['actorEmail']) ? $input['actorEmail'] : 'Admin';
            
            $stmt = $pdo->prepare('SELECT title FROM items WHERE id = ?');
            $stmt->execute([$itemId]);
            $item = $stmt->fetch();
            if (!$item) {
                http_response_code(404);
                echo json_encode(["error" => "Item not found"]);
                break;
            }
            
            $stmt = $pdo->prepare('DELETE FROM items WHERE id = ?');
            $stmt->execute([$itemId]);
            
            logEvent($pdo, "Deleted item ({$item['title']}) via Admin override.", $actorEmail);
            echo json_encode(["message" => "Item deleted successfully"]);
            break;

        // 11. Get Timeline Audit Logs
        case 'logs':
            if ($_SERVER['REQUEST_METHOD'] === 'GET') {
                $stmt = $pdo->query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
                echo json_encode($stmt->fetchAll());
            } else if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
                $actorEmail = isset($input['actorEmail']) ? $input['actorEmail'] : 'Admin';
                $pdo->query('DELETE FROM audit_logs');
                logEvent($pdo, 'Cleared audit timeline logs database.', $actorEmail);
                echo json_encode(["message" => "Audit logs cleared successfully"]);
            }
            break;

        default:
            http_response_code(404);
            echo json_encode(["error" => "Action not found"]);
            break;
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database exception: " . $e->getMessage()]);
}
?>
