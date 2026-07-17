<?php

return [
    /*
     * Government portal deep-links and guidance for the semi-auto "Upload to portal"
     * flow. CareVance NEVER submits to any government API — these URLs only open the
     * relevant portal in a new tab so the human can log in, upload the prepared file,
     * and pay. No credential vault, no RPA.
     */
    'pf_ecr' => [
        'url' => 'https://unifiedportal-emp.epfindia.gov.in/',
        'label' => 'EPFO Unified Portal — ECR Upload',
        'instructions' => 'Log in to the EPFO employer portal, go to "ECR Upload", and upload the downloaded .txt file. Verify the member-wise wages/PF split before final submission and generate the challan.',
        'form_reference' => 'ECR 2.0 (tab/|| delimited, 11 columns)',
    ],
    'esi_challan' => [
        'url' => 'https://portal.esic.gov.in/',
        'label' => 'ESIC Employer Portal — Monthly Contribution',
        'instructions' => 'Log in to the ESIC portal, navigate to "Monthly Contribution" / "Generate Challan", and either use the downloaded CSV upload or key the employee contributions manually. Pay the challan before the 15th.',
        'form_reference' => 'ESIC Monthly Contribution (CSV upload)',
    ],
    'form_24q' => [
        'url' => 'https://www.tdscpc.gov.in/',
        'label' => 'TDS-CPC (Protean) — e-TDS Filing',
        'instructions' => 'The downloaded XML is SOURCE DATA only. Feed it into NSDL-approved RPU software to build the FVU-validated e-TDS file, then upload via TDS-CPC / the TRACES portal. Quarterly due 15 days after quarter end.',
        'form_reference' => 'Form 24Q (Quarterly TDS return)',
    ],
    'form_16' => [
        'url' => 'https://www.traces.gov.in/',
        'label' => 'TRACES — Form 16 Part A',
        'instructions' => 'Form 16 Part B was generated locally as a PDF. Download Part A (the TRACES-issued TDS certificate) from TRACES after filing quarterly TDS returns, then attach it to Part B before distributing to the employee.',
        'form_reference' => 'Form 16 (Part A from TRACES, Part B generated)',
    ],
    'form_12ba' => [
        'url' => 'https://www.incometax.gov.in/',
        'label' => 'Income Tax e-Filing Portal',
        'instructions' => 'Form 12BA (perquisites statement) is generated locally as a PDF and issued to employees alongside Form 16. No separate portal upload is required for the statement itself.',
        'form_reference' => 'Form 12BA (Perquisites statement)',
    ],
    'pt_return' => [
        'url' => null,
        'label' => 'State Commercial Tax Department Portal',
        'instructions' => 'Professional Tax is a state subject. Use your state\'s commercial tax / professional tax department portal to make the payment / file the return. Upload-ready files are not accepted uniformly; the downloaded summary supports manual keying.',
        'form_reference' => 'PT Return (state-specific)',
        'states' => [
            'maharashtra' => ['url' => 'https://mahagst.gov.in/', 'form' => 'Maharashtra PT — Form III / monthly return'],
            'karnataka' => ['url' => 'https://www.karnatakaone.gov.in/', 'form' => 'Karnataka PT return'],
            'tamil_nadu' => ['url' => 'https://www.tn.gov.in/', 'form' => 'Tamil Nadu PT return'],
            'gujarat' => ['url' => 'https://www.gujaratindia.gov.in/', 'form' => 'Gujarat PT return'],
            'west_bengal' => ['url' => 'https://www.wbcomtax.gov.in/', 'form' => 'West Bengal PT return'],
            'delhi' => ['url' => 'https://tax.delhigovt.nic.in/', 'form' => 'Delhi PT return'],
            'haryana' => ['url' => 'https://haryana.gov.in/', 'form' => 'Haryana PT return'],
            'telangana' => ['url' => 'https://www.telangana.gov.in/', 'form' => 'Telangana PT return'],
            'andhra_pradesh' => ['url' => 'https://www.ap.gov.in/', 'form' => 'Andhra Pradesh PT return'],
            'rajasthan' => ['url' => 'https://rajasthan.gov.in/', 'form' => 'Rajasthan PT return'],
            'madhya_pradesh' => ['url' => 'https://www.mp.gov.in/', 'form' => 'Madhya Pradesh PT return'],
            'punjab' => ['url' => 'https://punjab.gov.in/', 'form' => 'Punjab PT return'],
            'odisha' => ['url' => 'https://odisha.gov.in/', 'form' => 'Odisha PT return'],
            'kerala' => ['url' => 'https://www.kerala.gov.in/', 'form' => 'Kerala PT return'],
        ],
    ],
    'lwf_return' => [
        'url' => null,
        'label' => 'State Labour Welfare Board Portal',
        'instructions' => 'Labour Welfare Fund is a state subject. Use your state\'s Labour Welfare Board portal to remit the contribution and file the return for the applicable period (monthly / bi-annual per state).',
        'form_reference' => 'LWF Return (state-specific)',
    ],
    'bonus_form_c' => [
        'url' => null,
        'label' => 'State Labour Department (PDF record)',
        'instructions' => 'Bonus Form C is generated locally as a text record under the Payment of Bonus Act. Maintain it as your annual return; file/submit per your state labour department\'s requirement.',
        'form_reference' => 'Bonus Form C (Annual Return)',
    ],
];
