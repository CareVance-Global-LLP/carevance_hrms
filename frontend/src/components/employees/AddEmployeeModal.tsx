import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Mail, UserPlus, Send } from 'lucide-react';
import { userApi, invitationApi, employeeWorkspaceApi, reportGroupApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel, ToggleInput } from '@/components/ui/FormField';

interface AddEmployeeModalProps {
  onClose: () => void;
  onSuccess: (message: string) => void;
  departments?: Array<{ id: number; name: string }>;
  organizationId?: number;
}

export default function AddEmployeeModal({ onClose, onSuccess, departments = [], organizationId }: AddEmployeeModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('employee');
  const [departmentId, setDepartmentId] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [phone, setPhone] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [password, setPassword] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pwd);
    setGeneratedPassword(pwd);
  };

  const createUserMutation = useMutation({
    mutationFn: async () => {
      const data: any = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
      };
      if (password) data.password = password;
      if (departmentId) data.group_ids = [parseInt(departmentId)];

      const res = await userApi.create(data);
      const newUser = res.data;
      const userId = newUser.id || (newUser as any).user?.id;

      if (joiningDate && userId) {
        try {
          await employeeWorkspaceApi.updateWorkInfo(userId, { joining_date: joiningDate });
        } catch (e) {
          // non-critical
        }
      }
      return { user: newUser, generatedPassword };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-workspace-users'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      const pwdMsg = generatedPassword ? ` Temporary password: ${generatedPassword}` : '';
      onSuccess(`Employee ${name.trim()} created successfully.${pwdMsg}`);
      onClose();
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.message || error?.message || 'Failed to create employee';
      alert(msg);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const data: any = {
        email: email.trim().toLowerCase(),
        role,
        delivery: 'email',
      };
      if (departmentId) data.group_ids = [parseInt(departmentId)];
      return invitationApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-workspace-invitations'] });
      onSuccess(`Invitation sent to ${email.trim().toLowerCase()}`);
      onClose();
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.message || error?.message || 'Failed to send invitation';
      alert(msg);
    },
  });

  const isSubmitting = createUserMutation.isPending || inviteMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    if (sendInvite) {
      inviteMutation.mutate();
    } else {
      createUserMutation.mutate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Add Employee</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <FieldLabel>Full Name <span className="text-rose-500">*</span></FieldLabel>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FieldLabel>Email <span className="text-rose-500">*</span></FieldLabel>
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@company.com"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Role</FieldLabel>
              <SelectInput value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
                <option value="client">Client</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Department</FieldLabel>
              <SelectInput value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">— Select —</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </SelectInput>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Joining Date</FieldLabel>
              <TextInput type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel>Phone</FieldLabel>
              <TextInput
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm text-slate-900">Send invitation email</p>
                <p className="text-xs text-slate-500">Employee will receive an email to set up their account</p>
              </div>
              <ToggleInput checked={sendInvite} onChange={(checked) => setSendInvite(checked)} />
            </div>

            {!sendInvite && (
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>Set Password</FieldLabel>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Generate
                  </button>
                </div>
                <TextInput
                  type="text"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setGeneratedPassword(''); }}
                  placeholder="Leave empty to auto-generate"
                />
                {generatedPassword && (
                  <p className="text-xs text-emerald-600 mt-1">
                    Temporary password: <strong>{generatedPassword}</strong> — share this with the employee
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={isSubmitting || !name.trim() || !email.trim()}
              iconLeft={sendInvite ? <Send className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            >
              {isSubmitting ? 'Processing...' : sendInvite ? 'Send Invite' : 'Create Employee'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
