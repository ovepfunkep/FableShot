export function TrainingTitleSuggestions({ titles, onChoose }: { titles: readonly string[]; onChoose: (title: string) => void }) {
  if (!titles.length) return null;
  return <div className="training-title-suggestions" aria-label="Частые названия" role="group">
    {titles.map(title => <button type="button" key={title} onClick={() => onChoose(title)}>{title}</button>)}
  </div>;
}
