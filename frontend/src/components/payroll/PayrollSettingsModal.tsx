import { useState, useEffect } from 'react';
import { X, Save, Building2, Percent, MapPin, IndianRupee, Loader2, CheckCircle } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface PayrollSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (settings: PayrollOrganizationSettings) => void;
}

export interface PayrollOrganizationSettings {
  defaultBasicPercentage: number;
  defaultHraPercentage: number;
  defaultConveyance: number;
  defaultState: string;
  defaultTaxRegime: 'new' | 'old';
  pfWageCap: number;
  esiThreshold: number;
  workingDaysPerMonth: number;
}

const INDIAN_STATES = [
  { value: 'maharashtra', label: 'Maharashtra' },
  { value: 'karnataka', label: 'Karnataka' },
  { value: 'tamil_nadu', label: 'Tamil Nadu' },
  { value: 'telangana', label: 'Telangana' },
  { value: 'andhra_pradesh', label: 'Andhra Pradesh' },
  { value: 'west_bengal', label: 'West Bengal' },
  { value: 'gujarat', label: 'Gujarat' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'punjab', label: 'Punjab' },
  { value: 'haryana', label: 'Haryana' },
  { value: 'rajasthan', label: 'Rajasthan' },
];

// Storage key for local persistence
const SETTINGS_STORAGE_KEY = 'carevance_payroll_settings';

// Default settings
const DEFAULT_SETTINGS: PayrollOrganizationSettings = {
  defaultBasicPercentage: 40,
  defaultHraPercentage: 50,
  defaultConveyance: 1600,
  defaultState: 'maharashtra',
  defaultTaxRegime: 'new',
  pfWageCap: 15000,
  esiThreshold: 21000,
  workingDaysPerMonth: 26,
};

export default function PayrollSettingsModal({ isOpen, onClose, onSave }: PayrollSettingsModalProps) {
  const [settings, setSettings] = useState<PayrollOrganizationSettings>(DEFAULT_SETTINGS);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (isOpen) {
      const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          setSettings({ ...DEFAULT_SETTINGS, ...parsed });
        } catch (e) {
          console.error('Failed to parse saved settings:', e);
          setSettings(DEFAULT_SETTINGS);
        }
      } else {
        setSettings(DEFAULT_SETTINGS);
      }
      setSaveSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    // Save to localStorage for persistence
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    
    // Call the onSave callback if provided
    onSave?.(settings);
    
    // Show success message
    setSaveSuccess(true);
    
    // Close after a delay
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1500);
  };

  const updateSetting = <K extends keyof PayrollOrganizationSettings>(
    key: K,
    value: PayrollOrganizationSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Payroll Settings</h2>
              <p className="text-sm text-slate-500">Configure default payroll parameters</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Success Message */}
          {saveSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              <p className="text-sm text-emerald-800">Settings saved successfully!</p>
            </div>
          )}

          {/* Default Salary Structure */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4 flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Default Salary Structure
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Basic (% of CTC)</FieldLabel>
                <TextInput
                  type="number"
                  value={settings.defaultBasicPercentage}
                  onChange={(e) => updateSetting('defaultBasicPercentage', parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                />
                <p className="text-xs text-slate-500 mt-1">Recommended: 40-50%</p>
              </div>
              <div>
                <FieldLabel>HRA (% of Basic)</FieldLabel>
                <TextInput
                  type="number"
                  value={settings.defaultHraPercentage}
                  onChange={(e) => updateSetting('defaultHraPercentage', parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Metro: 50%, Non-metro: 40%
                </p>
              </div>
              <div>
                <FieldLabel>Conveyance Allowance (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={settings.defaultConveyance}
                  onChange={(e) => updateSetting('defaultConveyance', parseFloat(e.target.value) || 0)}
                  min="0"
                />
                <p className="text-xs text-slate-500 mt-1">Standard: ₹1,600/month</p>
              </div>
              <div>
                <FieldLabel>Working Days/Month</FieldLabel>
                <TextInput
                  type="number"
                  value={settings.workingDaysPerMonth}
                  onChange={(e) => updateSetting('workingDaysPerMonth', parseInt(e.target.value) || 26)}
                  min="1"
                  max="31"
                />
                <p className="text-xs text-slate-500 mt-1">Usually 26 days (Mon-Sat)</p>
              </div>
            </div>
          </div>

          {/* Tax & Compliance */}
          <div className="pt-6 border-t border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Tax & Compliance Defaults
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Default State</FieldLabel>
                <SelectInput
                  value={settings.defaultState}
                  onChange={(e) => updateSetting('defaultState', e.target.value)}
                >
                  {INDIAN_STATES.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </SelectInput>
                <p className="text-xs text-slate-500 mt-1">Used for Professional Tax</p>
              </div>
              <div>
                <FieldLabel>Default Tax Regime</FieldLabel>
                <SelectInput
                  value={settings.defaultTaxRegime}
                  onChange={(e) => updateSetting('defaultTaxRegime', e.target.value as 'new' | 'old')}
                >
                  <option value="new">New Regime</option>
                  <option value="old">Old Regime</option>
                </SelectInput>
                <p className="text-xs text-slate-500 mt-1">New regime has lower rates</p>
              </div>
            </div>
          </div>

          {/* Statutory Limits */}
          <div className="pt-6 border-t border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4 flex items-center gap-2">
              <IndianRupee className="h-4 w-4" />
              Statutory Limits
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>PF Wage Cap (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={settings.pfWageCap}
                  onChange={(e) => updateSetting('pfWageCap', parseFloat(e.target.value) || 15000)}
                  min="0"
                />
                <p className="text-xs text-slate-500 mt-1">Max ₹15,000 for PF calculation</p>
              </div>
              <div>
                <FieldLabel>ESI Threshold (₹)</FieldLabel>
                <TextInput
                  type="number"
                  value={settings.esiThreshold}
                  onChange={(e) => updateSetting('esiThreshold', parseFloat(e.target.value) || 21000)}
                  min="0"
                />
                <p className="text-xs text-slate-500 mt-1">Gross salary limit for ESI</p>
              </div>
            </div>
          </div>

          {/* Information Note */}
          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-medium mb-1">Note:</p>
            <p className="text-blue-700">
              These settings will be used as defaults when creating new employee payroll templates. 
              Individual employee settings can be customized from their payroll page.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-slate-200">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            className="flex-1"
            onClick={handleSave}
            iconLeft={saveSuccess ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          >
            {saveSuccess ? 'Saved!' : 'Save Settings'}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}
