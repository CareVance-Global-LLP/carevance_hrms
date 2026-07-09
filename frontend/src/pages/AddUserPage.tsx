import { useNavigate } from 'react-router-dom';
import AddUserDrawer from '@/components/add-user/AddUserDrawer';

export default function AddUserPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <AddUserDrawer
        open
        presentation="inline"
        onClose={() => navigate('/employees')}
      />
    </div>
  );
}
