interface WizardActionsProps {
  currentStep: number | 'completed';
  showBack: boolean;
  showCancel: boolean;
  showSkip: boolean;
  isSubmitting: boolean;
  /**
   * The account is still being created in the background. Advancing is
   * pointless until it resolves — pressing Complete during this window used to
   * raise "Account is still being created", which then sat stacked on top of
   * the creation error when the create had actually failed.
   */
  isBusy?: boolean;
  onBack: () => void;
  onCancel?: () => void;
  onNext: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  /** Blocks the primary action for reasons the step itself explains (e.g. no seats left). */
  disabled?: boolean;
}

export function WizardActions({
  currentStep,
  showBack,
  showCancel,
  showSkip,
  isSubmitting,
  isBusy = false,
  onBack,
  onCancel,
  onNext,
  onSkip,
  nextLabel,
  disabled = false,
}: WizardActionsProps) {
  const blocked = isSubmitting || isBusy;
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
      <div>
        {showCancel && currentStep === 1 && onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors"
          >
            ← Back
          </button>
        )}
        {showBack && currentStep !== 'completed' && currentStep !== 1 && (
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors"
          >
            ← Back
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showSkip && currentStep === 3 && onSkip && (
          <button
            onClick={onSkip}
            disabled={blocked}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Skip Step 3
          </button>
        )}
        {/* Two independent reasons to block the primary action: isBusy while
            the account is still being created, and disabled when the step
            itself says no (e.g. no seats left). */}
        {currentStep !== 'completed' && (
          <button
            onClick={onNext}
            disabled={blocked || disabled}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {blocked && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {nextLabel || (currentStep === 3 ? 'Complete ✓' : 'Next →')}
          </button>
        )}
      </div>
    </div>
  );
}
