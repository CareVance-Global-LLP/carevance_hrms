<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: DejaVu Sans, sans-serif; font-size: 11px; line-height: 1.6; padding: 40px; }
.header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
.header h1 { font-size: 18px; margin-bottom: 5px; }
.header .org-name { font-size: 14px; color: #555; }
.content { margin-bottom: 20px; }
.date-line { text-align: right; margin-bottom: 20px; }
.subject { font-weight: bold; margin-bottom: 15px; }
table { width: 100%; border-collapse: collapse; margin: 15px 0; }
th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
th { background-color: #f5f5f5; }
.footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; }
.signature { margin-top: 30px; }
.signature div { display: inline-block; width: 45%; vertical-align: top; }
</style>
</head>
<body>
<div class="header">
    <h1>Salary Revision Letter</h1>
    <div class="org-name">{{ $organization->name }}</div>
</div>

<div class="date-line">
    <p>Date: {{ date('d F Y') }}</p>
</div>

<div class="content">
    <p><strong>To,</strong></p>
    <p>{{ $employee->name }}<br>
    {{ $employee->employeeWorkInfo->designation ?? 'Employee' }}<br>
    {{ $employee->employeeWorkInfo->employee_code ?? '' }}</p>

    <p class="subject">Subject: Revision of Compensation w.e.f. {{ $letter->effective_from->format('d F Y') }}</p>

    <p>Dear {{ $employee->name }},</p>

    <p>We are pleased to inform you that based on your performance and contributions, your compensation has been revised. Below are the details of your revised salary structure.</p>

    <table>
        <tr>
            <th>Component</th>
            <th>Current (₹)</th>
            <th>Revised (₹)</th>
            @if($letter->revision_percentage > 0)
            <th>Change</th>
            @endif
        </tr>
        <tr>
            <td><strong>Annual CTC</strong></td>
            <td><strong>₹{{ number_format($letter->old_ctc, 2) }}</strong></td>
            <td><strong>₹{{ number_format($letter->new_ctc, 2) }}</strong></td>
            @if($letter->revision_percentage > 0)
            <td><strong>{{ $letter->revision_percentage }}% ↑</strong></td>
            @endif
        </tr>
        <tr><td colspan="4" style="background:#f9f9f9;"><strong>Monthly Breakdown</strong></td></tr>
        <tr>
            <td>Basic</td>
            <td>₹{{ number_format($oldBreakdown['monthly']['basic'] ?? 0, 2) }}</td>
            <td>₹{{ number_format($newBreakdown['monthly']['basic'] ?? 0, 2) }}</td>
            @if($letter->revision_percentage > 0)
            <td>₹{{ number_format(($newBreakdown['monthly']['basic'] ?? 0) - ($oldBreakdown['monthly']['basic'] ?? 0), 2) }}</td>
            @endif
        </tr>
        <tr>
            <td>HRA</td>
            <td>₹{{ number_format($oldBreakdown['monthly']['hra'] ?? 0, 2) }}</td>
            <td>₹{{ number_format($newBreakdown['monthly']['hra'] ?? 0, 2) }}</td>
            @if($letter->revision_percentage > 0)
            <td>₹{{ number_format(($newBreakdown['monthly']['hra'] ?? 0) - ($oldBreakdown['monthly']['hra'] ?? 0), 2) }}</td>
            @endif
        </tr>
        <tr>
            <td>Conveyance</td>
            <td>₹{{ number_format($oldBreakdown['monthly']['conveyance'] ?? 0, 2) }}</td>
            <td>₹{{ number_format($newBreakdown['monthly']['conveyance'] ?? 0, 2) }}</td>
            @if($letter->revision_percentage > 0)
            <td>₹{{ number_format(($newBreakdown['monthly']['conveyance'] ?? 0) - ($oldBreakdown['monthly']['conveyance'] ?? 0), 2) }}</td>
            @endif
        </tr>
        <tr>
            <td>Special Allowance</td>
            <td>₹{{ number_format($oldBreakdown['monthly']['special_allowance'] ?? 0, 2) }}</td>
            <td>₹{{ number_format($newBreakdown['monthly']['special_allowance'] ?? 0, 2) }}</td>
            @if($letter->revision_percentage > 0)
            <td>₹{{ number_format(($newBreakdown['monthly']['special_allowance'] ?? 0) - ($oldBreakdown['monthly']['special_allowance'] ?? 0), 2) }}</td>
            @endif
        </tr>
        <tr>
            <td><strong>Gross Monthly</strong></td>
            <td><strong>₹{{ number_format($oldBreakdown['monthly']['gross'] ?? 0, 2) }}</strong></td>
            <td><strong>₹{{ number_format($newBreakdown['monthly']['gross'] ?? 0, 2) }}</strong></td>
            @if($letter->revision_percentage > 0)
            <td><strong>₹{{ number_format(($newBreakdown['monthly']['gross'] ?? 0) - ($oldBreakdown['monthly']['gross'] ?? 0), 2) }}</strong></td>
            @endif
        </tr>
    </table>

    <p><strong>Reason for revision:</strong> {{ $letter->reason ?? 'Performance-based annual increment' }}</p>
    <p><strong>Effective from:</strong> {{ $letter->effective_from->format('d F Y') }}</p>
</div>

<div class="footer">
    <p>Please sign a copy of this letter as a token of your acceptance of the revised terms.</p>

    <div class="signature">
        <div>
            <p><strong>Employee's Acceptance</strong></p>
            <p>Name: _________________________</p>
            <p>Signature: _________________________</p>
            <p>Date: _________________________</p>
        </div>
        <div style="text-align:right;">
            <p><strong>Authorized Signatory</strong></p>
            <p>For {{ $organization->name }}</p>
            <p>_________________________</p>
        </div>
    </div>
</div>
</body>
</html>
