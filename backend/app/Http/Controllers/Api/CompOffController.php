<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CompOffBalance;
use App\Models\CompOffTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CompOffController extends Controller
{
    public function balance(Request $request): JsonResponse
    {
        $user = $request->user();
        $year = $request->get('year', date('Y'));

        $balance = CompOffBalance::with('transactions')
            ->where('user_id', $user->id)
            ->where('applicable_year', $year)
            ->first();

        if (!$balance) {
            return response()->json([
                'balance' => null,
                'message' => 'No comp off balance found for this year',
            ]);
        }

        return response()->json([
            'balance' => $balance,
        ]);
    }

    public function transactions(Request $request): JsonResponse
    {
        $user = $request->user();

        $transactions = CompOffTransaction::with('balance')
            ->where('user_id', $user->id)
            ->orderBy('transaction_date', 'desc')
            ->paginate(20);

        return response()->json($transactions);
    }

    public function summary(Request $request): JsonResponse
    {
        $user = $request->user();

        $balances = CompOffBalance::where('user_id', $user->id)
            ->orderBy('applicable_year', 'desc')
            ->get();

        $totalEarned = $balances->sum('earned_days');
        $totalUsed = $balances->sum('used_days');
        $totalBalance = $balances->sum('balance_days');

        return response()->json([
            'total_earned' => $totalEarned,
            'total_used' => $totalUsed,
            'total_balance' => $totalBalance,
            'yearly_breakdown' => $balances,
        ]);
    }
}
