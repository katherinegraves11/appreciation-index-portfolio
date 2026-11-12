import BriefForm from "@/components/BriefForm";

export default function Classic() {
  return (
    <main className="wrap">
      <p className="eyebrow">Analyst form</p>
      <h1>Write a full brief</h1>
      <p className="lede">The detailed form, for when you want to set the horizon, client type, cohort and budget by hand.</p>
      <BriefForm />
    </main>
  );
}
