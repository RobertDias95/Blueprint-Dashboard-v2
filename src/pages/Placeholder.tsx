import { useParams } from 'react-router-dom';

// Q1: placeholder content for routes that aren't built yet. Renders the
// title + a one-liner about what'll go here, plus the URL params if any.
// Replaced per-route in Q2-Q7 as each view ships.
type PlaceholderProps = {
  title: string;
  description: string;
};

export default function Placeholder({ title, description }: PlaceholderProps) {
  const params = useParams();
  const paramKeys = Object.keys(params);
  return (
    <div className="max-w-2xl mx-auto bg-surface border border-border rounded-xl p-8 mt-12">
      <h1 className="font-display font-extrabold text-2xl text-text mb-2">
        {title}
      </h1>
      <p className="text-sm text-muted mb-4">{description}</p>
      {paramKeys.length > 0 && (
        <div className="bg-bg border border-border rounded-md px-3 py-2 font-mono text-xs text-muted">
          {paramKeys.map((k) => (
            <div key={k}>
              <span className="text-de">{k}</span>: {params[k] ?? '(empty)'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
