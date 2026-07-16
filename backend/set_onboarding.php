require __DIR__ . "/vendor/autoload.php";
$app = require_once __DIR__ . "/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\DB;
$emails = ["test2@gmail.com","test1@gmail.com","qa.customrole@carevance.test","qa.superadmin@carevance.test"];
foreach ($emails as $e) {
  $u = DB::table("users")->where("email", $e)->first();
  if (!$u) { echo "missing $e\n"; continue; }
  $settings = $u->settings ? json_decode($u->settings, true) : [];
  $settings["profile_onboarding_skipped"] = true;
  $settings["profile_onboarding_skipped_at"] = now()->toDateTimeString();
  DB::table("users")->where("id", $u->id)->update(["settings" => json_encode($settings)]);
  echo "updated $e\n";
}
echo "DONE\n";
