import { useNavigate } from 'react-router-dom';
import UnassignedEmployees from '@/components/payroll/UnassignedEmployees';

export default function UnassignedEmployeesPage() {
  const navigate = useNavigate();
  return <UnassignedEmployees onBack={() => navigate('/payroll')} />;
}
