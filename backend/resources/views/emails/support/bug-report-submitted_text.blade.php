New bug report received
------------------------------------------------------------

REPORTER
  Name       {!! $bugReport->name ?: 'Not provided' !!}
  Email      {!! $bugReport->email !!}
  Category   {!! $bugReport->issue_category !!}
  Route      {!! $bugReport->current_path ?: 'Not provided' !!}

SUMMARY
{!! $bugReport->summary !!}

DESCRIPTION
{!! $bugReport->description !!}

------------------------------------------------------------
{{ config('brand.label') }} - internal support notification.
