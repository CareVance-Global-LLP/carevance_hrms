{{--
  Shared chrome for the declaration forms.

  Dompdf is the renderer, so its constraints are the constraints: no flexbox,
  no grid, no external assets. Tables and inline styles only — the same
  pipeline Form 16 and Form 12BA already use, and deliberately the same look,
  because a bundle of statutory forms that do not match each other reads as
  assembled rather than issued.

  Expects: $formTitle, $formSubtitle (optional, may contain markup), $employer,
  and optionally $run.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ $formTitle }}@isset($run) — {{ $run->month_year ?? '' }}@endisset</title>
<style>
  body { font-family: DejaVu Sans, sans-serif; font-size: 10px; line-height: 1.45; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #888; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .header { text-align: center; margin-bottom: 12px; }
  .sub { font-size: 10px; color: #555; }
  .meta-grid { width: 100%; border: none; margin-bottom: 8px; }
  .meta-grid td { border: none; padding: 1px 4px; }
  .meta-grid td:first-child { width: 24%; font-weight: 600; }
  .footer { margin-top: 18px; font-size: 9px; color: #555; text-align: center; }
  .grand { font-weight: 700; background: #fffbe6; }
  .empty { text-align: center; color: #666; font-style: italic; padding: 10px; }
  .note { font-size: 9px; color: #555; margin: 6px 0; }
  .sign { margin-top: 26px; }
  .sign td { border: none; padding-top: 26px; font-size: 9px; }
  .sign td.line { border-top: 1px solid #333; width: 40%; }
</style>
</head>
<body>

<div class="header">
  <h1>{{ strtoupper($formTitle) }}</h1>
  @isset($formSubtitle)
    <div class="sub">{!! $formSubtitle !!}</div>
  @endisset
  @isset($run)
    <div class="sub"><strong>Period: {{ $run->month_year ?? '—' }}</strong></div>
  @endisset
</div>

<table class="meta-grid">
  <tr><td>Establishment</td><td>{{ $employer->name ?? '—' }}</td></tr>
  @if(!empty($employer?->address))
    <tr><td>Address</td><td>{{ $employer->address }}</td></tr>
  @endif
</table>
