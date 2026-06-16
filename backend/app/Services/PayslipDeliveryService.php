<?php

namespace App\Services;

use App\Models\Payslip;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

/**
 * Payslip Delivery Service
 *
 * Multi-channel delivery of payslips to employees:
 *  - Email with PDF attachment
 *  - WhatsApp message (via WhatsApp Business Cloud API)
 *  - SMS link
 *  - In-app notification (always)
 *
 * Track delivery status per channel for auditability.
 */
class PayslipDeliveryService
{
    public function deliver(Payslip $payslip, array $channels = ['email', 'in_app']): array
    {
        $results = [];
        $employee = $payslip->employee ?? $payslip->user;
        $pdfPath = $this->ensurePdf($payslip);

        if (in_array('email', $channels, true) && !empty($employee->email)) {
            $results['email'] = $this->sendEmail($payslip, $employee, $pdfPath);
        }
        if (in_array('whatsapp', $channels, true) && !empty($employee->phone)) {
            $results['whatsapp'] = $this->sendWhatsapp($payslip, $employee, $pdfPath);
        }
        if (in_array('sms', $channels, true) && !empty($employee->phone)) {
            $results['sms'] = $this->sendSms($payslip, $employee);
        }
        if (in_array('in_app', $channels, true)) {
            $results['in_app'] = $this->sendInApp($payslip, $employee);
        }

        $payslip->update([
            'delivery_status' => $results,
            'delivered_at' => now(),
        ]);
        return $results;
    }

    protected function ensurePdf(Payslip $payslip): string
    {
        if ($payslip->pdf_path && Storage::exists($payslip->pdf_path)) {
            return $payslip->pdf_path;
        }
        $generator = app(PayslipPdfService::class);
        $path = $generator->generate($payslip);
        $payslip->update(['pdf_path' => $path]);
        return $path;
    }

    protected function sendEmail(Payslip $payslip, $employee, string $pdfPath): array
    {
        try {
            Mail::send('emails.payslip', ['payslip' => $payslip, 'employee' => $employee], function ($m) use ($employee, $payslip, $pdfPath) {
                $m->to($employee->email)
                  ->subject("Payslip for " . $payslip->payroll_period_label)
                  ->attach(Storage::path($pdfPath), ['as' => 'payslip.pdf', 'mime' => 'application/pdf']);
            });
            return ['status' => 'sent', 'channel' => 'email', 'address' => $employee->email];
        } catch (\Throwable $e) {
            Log::error('Payslip email failed', ['payslip' => $payslip->id, 'err' => $e->getMessage()]);
            return ['status' => 'failed', 'channel' => 'email', 'error' => $e->getMessage()];
        }
    }

    protected function sendWhatsapp(Payslip $payslip, $employee, string $pdfPath): array
    {
        $token = config('services.whatsapp.token');
        $phoneId = config('services.whatsapp.phone_id');
        $to = preg_replace('/\D/', '', $employee->phone);
        if (!$token || !$phoneId) {
            return ['status' => 'skipped', 'channel' => 'whatsapp', 'reason' => 'whatsapp_not_configured'];
        }
        try {
            $url = "https://graph.facebook.com/v18.0/{$phoneId}/messages";
            $body = [
                'messaging_product' => 'whatsapp',
                'to' => '91' . substr($to, -10),
                'type' => 'template',
                'template' => [
                    'name' => 'payslip_ready',
                    'language' => ['code' => 'en'],
                    'components' => [
                        ['type' => 'body', 'parameters' => [
                            ['type' => 'text', 'text' => $employee->name],
                            ['type' => 'text', 'text' => $payslip->payroll_period_label],
                            ['type' => 'text', 'text' => '₹' . number_format((float)$payslip->net_pay, 2)],
                        ]],
                    ],
                ],
            ];
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($body),
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $token],
            ]);
            $response = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            return $code >= 200 && $code < 300
                ? ['status' => 'sent', 'channel' => 'whatsapp', 'phone' => $to]
                : ['status' => 'failed', 'channel' => 'whatsapp', 'http_code' => $code, 'response' => $response];
        } catch (\Throwable $e) {
            return ['status' => 'failed', 'channel' => 'whatsapp', 'error' => $e->getMessage()];
        }
    }

    protected function sendSms(Payslip $payslip, $employee): array
    {
        $link = config('app.url') . "/payslips/{$payslip->id}/view?token=" . md5($payslip->id . config('app.key'));
        $msg = "Hi {$employee->first_name}, your payslip for {$payslip->payroll_period_label} is ready. Net: INR " . number_format((float)$payslip->net_pay, 2) . ". View: {$link}";
        // Delegate to SmsService if it exists
        if (class_exists(\App\Services\SmsService::class)) {
            return app(\App\Services\SmsService::class)->send($employee->phone, $msg);
        }
        return ['status' => 'skipped', 'channel' => 'sms', 'reason' => 'sms_service_unavailable'];
    }

    protected function sendInApp(Payslip $payslip, $employee): array
    {
        try {
            if (class_exists(\App\Models\Notification::class)) {
                \App\Models\Notification::create([
                    'user_id' => $employee->id,
                    'type' => 'payslip.published',
                    'title' => 'Payslip ready',
                    'body' => "Your payslip for {$payslip->payroll_period_label} is now available",
                    'data' => ['payslip_id' => $payslip->id],
                ]);
            }
            return ['status' => 'sent', 'channel' => 'in_app'];
        } catch (\Throwable $e) {
            return ['status' => 'failed', 'channel' => 'in_app', 'error' => $e->getMessage()];
        }
    }
}
