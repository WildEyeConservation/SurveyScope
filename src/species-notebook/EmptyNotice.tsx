export function EmptyNotice({
  name,
  loading,
  borrowedSurveys,
  hasExamples,
}: {
  name: string;
  loading: boolean;
  borrowedSurveys: number;
  hasExamples: boolean;
}) {
  return (
    <div className='flex flex-col gap-1 border border-white/10 bg-white/5 px-3 py-2 text-sm'>
      <span>No {name} annotated in this survey yet.</span>
      <span className='text-xs text-muted-foreground'>
        {loading
          ? 'Looking for examples in other surveys in your organisation…'
          : hasExamples
            ? `Examples come from ${borrowedSurveys} other survey${borrowedSurveys === 1 ? '' : 's'} in your organisation with a label named exactly “${name}”.`
            : `No other survey in your organisation has “${name}” annotations.`}
      </span>
    </div>
  );
}
