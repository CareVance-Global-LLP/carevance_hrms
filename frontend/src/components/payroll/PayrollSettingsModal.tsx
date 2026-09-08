import { useState, useEffect } from 'react';
import { X, Save, Building2, Loader2, CheckCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/dialog/Modal';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import type { PayrollOrganizationSettings } from '@/types';

interface PayrollSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (settings: PayrollOrganizationSettings) => void;
}

const INDIAN_STATES = [
  { value: 'andhra_pradesh', label: 'Andhra Pradesh' },
  { value: 'assam', label: 'Assam' },
  { value: 'bihar', label: 'Bihar' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'gujarat', label: 'Gujarat' },
  { value: 'haryana', label: 'Haryana' },
  { value: 'jharkhand', label: 'Jharkhand' },
  { value: 'karnataka', label: 'Karnataka' },
  { value: 'kerala', label: 'Kerala' },
  { value: 'madhya_pradesh', label: 'Madhya Pradesh' },
  { value: 'maharashtra', label: 'Maharashtra' },
  { value: 'odisha', label: 'Odisha' },
  { value: 'punjab', label: 'Punjab' },
  { value: 'rajasthan', label: 'Rajasthan' },
  { value: 'tamil_nadu', label: 'Tamil Nadu' },
  { value: 'telangana', label: 'Telangana' },
  { value: 'uttar_pradesh', label: 'Uttar Pradesh' },
  { value: 'west_bengal', label: 'West Bengal' },
];

const DEFAULT_SETTINGS: PayrollOrganizationSettings = {
  defaultBasicPercentage: 40,
  defaultHraPercentage: 20,
  defaultConveyance: 0,
  /*
   * Unset, not a state. This read 'gujarat', and the spread below
   * (`{...DEFAULT_SETTINGS, ...settingsData.settings}`) means anything the
   * API does not send survives — so for an organisation that has never named
   * a professional tax state, opening this dialog and pressing Save would
   * commit Gujarat's slabs to every employee template. The API used to hide
   * that by always sending 'maharashtra'; it now correctly sends nothing.
   */
  defaultState: null,
  defaultTaxRegime: 'new',
  pfWageCap: 15000,
  esiThreshold: 21000,
  workingDaysPerMonth: 26,
  pfEmployeePercentage: 12,
  pfEmployerPercentage: 12,
  esiEmployeePercentage: 0.75,
  esiEmployerPercentage: 3.25,
  pfEnabled: true,
  esiEnabled: true,
  ptEnabled: true,
  tdsEnabled: true,
  lwfEnabled: false,
  isMetroCity: true,
};

export default function PayrollSettingsModal({ isOpen, onClose, onSave }: PayrollSettingsModalProps) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<PayrollOrganizationSettings>(DEFAULT_SETTINGS);

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['payroll', 'settings'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data),
    enabled: isOpen,
  });

  useEffect(() => {
    if (settingsData?.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...settingsData.settings });
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: (newSettings: Partial<PayrollOrganizationSettings>) =>
      payrollApi.updatePayrollSettings(newSettings),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'settings'] });
      onSave?.(res.data.settings);
      setTimeout(() => {
        onClose();
      }, 1000);
    },
  });

  if (!isOpen) {
    return null;
  }

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const updateSetting = <K extends keyof PayrollOrganizationSettings>(
    key: K,
    value: PayrollOrganizationSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      titleId="payroll-settings-title"
      widthClassName="max-w-[560px]"
      panelClassName="max-h-[90vh]"
      busy={saveMutation.isPending}
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div id="payroll-settings-title" className="text-base font-bold text-slate-900">Payroll Settings</div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-md transition-colors">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
            </div>
          ) : (
            <>
              {saveMutation.isSuccess && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm text-emerald-800">Settings saved successfully!</p>
                </div>
              )}

              {saveMutation.isError && (
                <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-rose-600" />
                  <p className="text-sm text-rose-800">Failed to save settings. Please try again.</p>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Salary Structure Defaults
                </div>

                <div className="mb-4">
                  <FieldLabel>Working Days / Month</FieldLabel>
                  <TextInput
                    type="number"
                    value={settings.workingDaysPerMonth}
                    onChange={(e) => updateSetting('workingDaysPerMonth', parseInt(e.target.value) || 26)}
                    min="1"
                    max="31"
                  />
                </div>

                <div className="mb-1">
                  <FieldLabel>Salary Structure %</FieldLabel>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Basic</div>
                    <TextInput
                      type="number"
                      value={settings.defaultBasicPercentage}
                      onChange={(e) => updateSetting('defaultBasicPercentage', parseFloat(e.target.value) || 0)}
                      min="0"
                      max="100"
                      className="text-center"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">HRA</div>
                    <TextInput
                      type="number"
                      value={settings.defaultHraPercentage}
                      onChange={(e) => updateSetting('defaultHraPercentage', parseFloat(e.target.value) || 0)}
                      min="0"
                      max="100"
                      className="text-center"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Special</div>
                    <TextInput
                      type="number"
                      value={(settings as any).defaultSpecialPercentage ?? 40}
                      onChange={(e) => updateSetting('defaultSpecialPercentage' as any, parseFloat(e.target.value) || 0)}
                      min="0"
                      max="100"
                      className="text-center"
                    />
                  </div>
                </div>
              </div>

              <div className="my-5 border-t border-slate-200" />

              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Tax & Statutory
                </div>

                <div className="mb-4">
                  <FieldLabel>Default Tax Regime</FieldLabel>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        settings.defaultTaxRegime === 'old'
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                      onClick={() => updateSetting('defaultTaxRegime', 'old')}
                    >
                      Old Regime
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        settings.defaultTaxRegime === 'new'
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                      onClick={() => updateSetting('defaultTaxRegime', 'new')}
                    >
                      New Regime
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <FieldLabel>PT State</FieldLabel>
                  <SelectInput
                    value={settings.defaultState ?? ''}
                    onChange={(e) => updateSetting('defaultState', e.target.value || null)}
                  >
                    {/*
                      * An empty first option so an unset state shows as unset.
                      * SelectInput falls back to options[0] when nothing
                      * matches, so without this the dialog would display —
                      * and on save commit — whichever state happens to sort
                      * first in INDIAN_STATES.
                      */}
                    <option value="">No professional tax / not set</option>
                    {INDIAN_STATES.map((state) => (
                      <option key={state.value} value={state.value}>
                        {state.label}
                      </option>
                    ))}
                  </SelectInput>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-700">PF Wage Cap</span>
                  <TextInput
                    type="number"
                    value={settings.pfWageCap}
                    onChange={(e) => updateSetting('pfWageCap', parseFloat(e.target.value) || 15000)}
                    min="0"
                    className="w-[120px] text-right"
                  />
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-700">ESI Threshold</span>
                  <TextInput
                    type="number"
                    value={settings.esiThreshold}
                    onChange={(e) => updateSetting('esiThreshold', parseFloat(e.target.value) || 21000)}
                    min="0"
                    className="w-[120px] text-right"
                  />
                </div>
              </div>

              <div className="my-5 border-t border-slate-200" />

              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Pay Schedule
                </div>
                <div>
                  <FieldLabel>Pay Day</FieldLabel>
                  <TextInput
                    type="number"
                    value={(settings as any).payDay ?? 28}
                    onChange={(e) => updateSetting('payDay' as any, parseInt(e.target.value) || 28)}
                    min="1"
                    max="31"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saveMutation.isPending || isLoading}
            iconLeft={saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
    </Modal>
  );
}
