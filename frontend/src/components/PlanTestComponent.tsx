import React from 'react';
import { usePlan } from '../hooks/usePlan';

const PlanTestComponent: React.FC = () => {
  const { planCode, hasFeature } = usePlan();
  
  return (
    <div>
      <h1>Plan Test Component</h1>
      <p>Current Plan: {planCode}</p>
      <p>Has Payroll Feature: {hasFeature('payroll') ? 'Yes' : 'No'}</p>
      <p>Has Reports Feature: {hasFeature('reports') ? 'Yes' : 'No'}</p>
    </div>
  );
};

export default PlanTestComponent;