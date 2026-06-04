import { useState } from 'react';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface CheckInOutButtonProps {
  isCheckedIn: boolean;
  todayDuration: string;
  onStatusChange?: (isCheckedIn: boolean) => void;
}

export default function CheckInOutButton({
  isCheckedIn: initialCheckedIn,
  todayDuration,
  onStatusChange,
}: CheckInOutButtonProps) {
  const [isCheckedIn, setIsCheckedIn] = useState(initialCheckedIn);
  const queryClient = useQueryClient();

  const checkInMutation = useMutation({
    mutationFn: payrollApi.checkIn,
    onSuccess: () => {
      setIsCheckedIn(true);
      onStatusChange?.(true);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'dashboard'] });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: payrollApi.checkOut,
    onSuccess: () => {
      setIsCheckedIn(false);
      onStatusChange?.(false);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'dashboard'] });
    },
  });

  const handleCheckIn = () => {
    checkInMutation.mutate();
  };

  const handleCheckOut = () => {
    checkOutMutation.mutate();
  };

  const isLoading = checkInMutation.isPending || checkOutMutation.isPending;

  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Today's Hours</h3>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-950">{todayDuration}</p>
          <p className="mt-1 text-xs text-slate-500">
            {isCheckedIn ? 'Currently working' : 'Not clocked in'}
          </p>
        </div>

        <div>
          {isCheckedIn ? (
            <Button
              variant="danger"
              size="lg"
              onClick={handleCheckOut}
              disabled={isLoading}
              iconLeft={<LogOut className="h-5 w-5" />}
            >
              {isLoading ? 'Processing...' : 'Check Out'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              onClick={handleCheckIn}
              disabled={isLoading}
              iconLeft={<LogIn className="h-5 w-5" />}
            >
              {isLoading ? 'Processing...' : 'Check In'}
            </Button>
          )}
        </div>
      </div>

      {checkInMutation.error && (
        <p className="mt-3 text-sm text-red-600">
          {checkInMutation.error instanceof Error ? checkInMutation.error.message : 'Failed to check in'}
        </p>
      )}

      {checkOutMutation.error && (
        <p className="mt-3 text-sm text-red-600">
          {checkOutMutation.error instanceof Error ? checkOutMutation.error.message : 'Failed to check out'}
        </p>
      )}
    </SurfaceCard>
  );
}
