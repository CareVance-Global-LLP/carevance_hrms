import { useState } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Clock, 
  Activity,
  TrendingUp,
  TrendingDown,
  Calculator,
  MoreHorizontal,
  User,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  CreditCard,
  Loader2,
  X
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollDepartmentEmployee } from '@/types';

interface DepartmentEmployeesProps {
  departmentId: number;
  monthYear: string;
  onBack: () => void;
  onSelectEmployee: (employeeId: number) => void;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Payment Modal Component
interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: PayrollDepartmentEmployee | null;
  onPaymentSuccess: () => void;
}

function PaymentModal({ isOpen, onClose, employee, onPaymentSuccess }: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'cash' | 'razorpay'>('bank_transfer');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !employee) return null;

  const handlePayment = async () => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Import the type for payroll calculation
      const payrollCalc = {
        annual: { ctc: 0, gross: 0 },
        monthly: {
          ctc: employee.payroll_status.gross_salary,
          gross: employee.payroll_status.gross_salary,
          net: employee.payroll_status.net_pay,
          total_deductions: employee.payroll_status.total_deductions
        },
        components: {
          earnings: { basic: 0, hra: 0, conveyance: 0, special_allowance: 0 },
          deductions: { pf_employee: 0, esi_employee: 0, pt: 0, tds: 0 },
          employer_contributions: { pf_employer: 0, eps: 0, epf: 0, esi_employer: 0, gratuity: 0 }
        },
        breakdown: { pf_wages: 0, pf_cap_applied: false, esi_applicable: false, tax_regime: 'new' }
      };
      
      // Call the payment API
      const response = await payrollApi.processPayment({
        user_id: employee.id,
        amount: employee.payroll_status.net_pay,
        payment_method: paymentMethod,
        month: new Date().toISOString().slice(0, 7),
        payroll_data: payrollCalc as any
      });
      
      if (response.data.success) {
        onPaymentSuccess();
        onClose();
      } else {
        setError(response.data.message || 'Payment failed');
      }
    } catch (err: any) {
      console.error('Payment failed:', err);
      setError(err?.response?.data?.message || err?.message || 'Payment processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Process Payment</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
              <p className="text-sm text-rose-700">
                <strong>Error:</strong> {error}
              </p>
            </div>
          )}
          
          {/* Employee Info */}
          <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
              <User className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{employee.name}</p>
              <p className="text-sm text-slate-500">{employee.email}</p>
            </div>
          </div>

          {/* Payment Amount */}
          <div className="text-center p-4 bg-emerald-50 rounded-lg">
            <p className="text-sm text-emerald-600 mb-1">Net Pay Amount</p>
            <p className="text-3xl font-bold text-emerald-700">
              {formatCurrency(employee.payroll_status.net_pay)}
            </p>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">
              Select Payment Method
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="bank_transfer"
                  checked={paymentMethod === 'bank_transfer'}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="h-4 w-4 text-blue-600"
                />
                <CreditCard className="h-5 w-5 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">Bank Transfer</p>
                  <p className="text-xs text-slate-500">NEFT/RTGS/IMPS</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="razorpay"
                  checked={paymentMethod === 'razorpay'}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="h-4 w-4 text-blue-600"
                />
                <DollarSign className="h-5 w-5 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">Online Payment</p>
                  <p className="text-xs text-slate-500">UPI, Card, Net Banking</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-slate-50">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="h-4 w-4 text-blue-600"
                />
                <DollarSign className="h-5 w-5 text-slate-400" />
                <div>
                  <p className="font-medium text-slate-900">Cash Payment</p>
                  <p className="text-xs text-slate-500">Physical cash payment</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-slate-200">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            className="flex-1"
            onClick={handlePayment}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Confirm Payment
              </span>
            )}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}

export default function DepartmentEmployees({ 
  departmentId, 
  monthYear, 
  onBack, 
  onSelectEmployee 
}: DepartmentEmployeesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<PayrollDepartmentEmployee | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payroll', 'department', departmentId, 'employees', monthYear, searchQuery],
    queryFn: () => payrollApi.getDepartmentEmployees(departmentId, { 
      month_year: monthYear,
      search: searchQuery || undefined 
    }).then(res => res.data),
  });

  const employees = data?.employees || [];

  const handleOpenPayment = (employee: PayrollDepartmentEmployee, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEmployee(employee);
    setPaymentModalOpen(true);
  };

  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string | null>(null);

  const handlePaymentSuccess = () => {
    // Show success message
    setPaymentSuccessMessage('Payment processed successfully!');
    setTimeout(() => setPaymentSuccessMessage(null), 3000);
    
    // Refresh the employee list
    refetch();
    // Also invalidate related queries
    queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'departments'] });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {departmentId === 0 ? 'Unassigned Employees' : 'Department Employees'}
          </h1>
          <p className="text-sm text-slate-500">{employees.length} employees found</p>
        </div>
      </div>

      {/* Success Message */}
      {paymentSuccessMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <p className="text-sm text-emerald-800">{paymentSuccessMessage}</p>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <TextInput
          placeholder="Search employees by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Employees Table */}
      <SurfaceCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Tracking</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Productivity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Salary</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Pay</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Loading employees...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No employees found
                  </td>
                </tr>
              ) : (
                employees.map((employee) => (
                  <tr 
                    key={employee.id} 
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => onSelectEmployee(employee.id)}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center">
                          {employee.avatar ? (
                            <img src={employee.avatar} alt={employee.name} className="h-10 w-10 rounded-full" />
                          ) : (
                            <User className="h-5 w-5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{employee.name}</p>
                          <p className="text-xs text-slate-500">{employee.designation || employee.email}</p>
                          {employee.employee_code && (
                            <p className="text-xs text-slate-400">{employee.employee_code}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span>{employee.time_tracking.total_worked_hours.toFixed(1)}h</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Activity className="h-3 w-3" />
                          <span>{employee.time_tracking.activity_percentage.toFixed(0)}% active</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-emerald-600">{employee.time_tracking.total_productive_hours.toFixed(1)}h productive</span>
                          <span className="text-slate-300">|</span>
                          <span className="text-rose-500">{employee.time_tracking.total_idle_hours.toFixed(1)}h idle</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min(employee.time_tracking.productivity_score, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{employee.time_tracking.productivity_score.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {employee.payroll_status.is_processed ? (
                        <span className="font-medium">{formatCurrency(employee.payroll_status.gross_salary)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {employee.payroll_status.is_processed ? (
                        <span className="font-semibold text-emerald-600">{formatCurrency(employee.payroll_status.net_pay)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {employee.payroll_status.is_processed ? (
                        employee.payroll_status.payment_status === 'paid' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />
                            Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                            <DollarSign className="h-3 w-3" />
                            Pending
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                          <AlertCircle className="h-3 w-3" />
                          Not Calculated
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEmployee(employee.id);
                          }}
                        >
                          <Calculator className="h-4 w-4 mr-1" />
                          Payroll
                        </Button>
                        
                        {/* Pay Button - Only show if payroll is processed but not paid */}
                        {employee.payroll_status.is_processed && 
                         employee.payroll_status.payment_status !== 'paid' && (
                          <Button 
                            variant="primary" 
                            size="sm"
                            onClick={(e) => handleOpenPayment(employee, e)}
                          >
                            <DollarSign className="h-3 w-3 mr-1" />
                            Pay
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        employee={selectedEmployee}
        onPaymentSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
