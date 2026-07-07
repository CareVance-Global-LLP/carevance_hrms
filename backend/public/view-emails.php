<?php
// Simple email viewer for log driver
// Access: http://localhost:8000/view-emails

$logFile = __DIR__ . '/../storage/logs/laravel.log';
$emails = [];

if (file_exists($logFile)) {
    $content = file_get_contents($logFile);
    
    // Parse emails from log
    preg_match_all('/From:.*?To:.*?Subject:.*?(?=\[\d{4}-\d{2}-\d{2}|$)/s', $content, $matches);
    
    foreach ($matches[0] as $email) {
        preg_match('/To: (.*?)$/m', $email, $to);
        preg_match('/Subject: (.*?)$/m', $email, $subject);
        preg_match('/Date: (.*?)$/m', $email, $date);
        
        // Extract verification link
        preg_match('/href="([^"]*verify[^"]*)"/', $email, $link);
        
        $emails[] = [
            'to' => $to[1] ?? 'Unknown',
            'subject' => $subject[1] ?? 'Unknown',
            'date' => $date[1] ?? 'Unknown',
            'link' => $link[1] ?? '',
            'raw' => htmlspecialchars($email)
        ];
    }
}

?>
<!DOCTYPE html>
<html>
<head>
    <title>Email Viewer - Local Development</title>
    <style>
        body { font-family: Arial; padding: 20px; background: #f0f0f0; }
        .email-card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .email-header { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 15px; }
        .verify-btn { display: inline-block; padding: 12px 24px; background: #0284c7; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
        .verify-btn:hover { background: #0369a1; }
        .label { font-weight: bold; color: #666; }
        .empty { text-align: center; padding: 40px; color: #999; }
    </style>
</head>
<body>
    <h1>📧 Local Development Email Viewer</h1>
    <p style="color: #666;">Since MAIL_MAILER=log is set, emails are saved here instead of being sent.</p>
    
    <?php if (empty($emails)): ?>
        <div class="empty">
            <h2>No emails yet</h2>
            <p>Sign up at <a href="http://localhost:5173/start-trial">http://localhost:5173/start-trial</a> to see emails here.</p>
        </div>
    <?php else: ?>
        <p><strong><?php echo count($emails); ?></strong> email(s) found</p>
        
        <?php foreach ($emails as $i => $email): ?>
            <div class="email-card">
                <div class="email-header">
                    <p><span class="label">To:</span> <?php echo $email['to']; ?></p>
                    <p><span class="label">Subject:</span> <?php echo $email['subject']; ?></p>
                    <p><span class="label">Date:</span> <?php echo $email['date']; ?></p>
                </div>
                
                <?php if ($email['link']): ?>
                    <p><strong>Verification Link:</strong></p>
                    <a href="<?php echo html_entity_decode($email['link']); ?>" class="verify-btn">✓ Click here to verify email</a>
                    <p style="font-size: 12px; color: #666; margin-top: 10px;">
                        Or copy this URL:<br>
                        <code><?php echo html_entity_decode($email['link']); ?></code>
                    </p>
                <?php endif; ?>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>
    
    <hr>
    <p style="text-align: center; color: #999;">
        <a href="/view-emails">🔄 Refresh</a> | 
        <a href="http://localhost:5173/start-trial">📝 Go to Signup</a>
    </p>
</body>
</html>