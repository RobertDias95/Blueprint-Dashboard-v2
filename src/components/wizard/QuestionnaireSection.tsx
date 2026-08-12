import { usePermitDescriptions } from '../../hooks/usePermitDescriptions';

// fix-22 Step 2 sub-component — renders one bucket (Commonly / Sometimes
// / Other) as a list of checkboxes with optional usage% badges and a
// short v1-sourced description under the permit name.
//
// Building Permit always appears in the "Commonly" bucket with the
// checkbox locked-on. The parent (Step2Questionnaire) handles that wiring;
// this component just respects `lockedOn` on each item.

export interface QuestionnaireItem {
  type: string;
  /** Set when stats exist + this permit type has >=5 usages in the juris.
   *  Renders as a small "62%" badge. Null = hide badge. */
  pct: number | null;
  /** When true, the checkbox is force-checked + disabled. Building
   *  Permit always uses this. */
  lockedOn?: boolean;
  /** Optional secondary label (e.g. "recommended" for the top "sometimes"
   *  permit). */
  badge?: string;
}

interface Props {
  title: string;
  items: QuestionnaireItem[];
  /** Map of type → selected. Parent owns the state; this component is
   *  controlled. */
  selectedByType: Record<string, boolean>;
  onToggle: (type: string, next: boolean) => void;
  testIdPrefix: string;
}

export default function QuestionnaireSection({
  title,
  items,
  selectedByType,
  onToggle,
  testIdPrefix,
}: Props) {
  // fix-288: descriptions come from app_config now, so editing one is a
  // Settings change rather than a deploy. Read here rather than threaded down
  // from Step2Questionnaire — four call sites would each have to pass it, and
  // this ticket must not touch the bucketing logic above.
  const descriptions = usePermitDescriptions();
  if (items.length === 0) return null;
  return (
    <div data-testid={`${testIdPrefix}-section`}>
      <div className="text-[10px] uppercase tracking-wide text-dim mb-1.5 font-display font-bold">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((it) => {
          const checked = !!selectedByType[it.type] || !!it.lockedOn;
          return (
            <label
              key={it.type}
              className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-border bg-surface hover:bg-s2 text-xs cursor-pointer transition"
              data-testid={`${testIdPrefix}-item-${it.type}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={it.lockedOn}
                onChange={(e) => onToggle(it.type, e.target.checked)}
                data-testid={`${testIdPrefix}-checkbox-${it.type}`}
                className="h-3.5 w-3.5 mt-0.5 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-text">{it.type}</span>
                  {it.badge && (
                    <span className="text-[9px] uppercase tracking-wide text-de border border-de/40 rounded px-1.5 py-0.5">
                      {it.badge}
                    </span>
                  )}
                  {it.pct !== null && (
                    <span
                      className="text-[10px] font-mono text-muted"
                      data-testid={`${testIdPrefix}-pct-${it.type}`}
                    >
                      {it.pct}%
                    </span>
                  )}
                  {it.lockedOn && (
                    <span className="text-[9px] uppercase tracking-wide text-muted">
                      (always required)
                    </span>
                  )}
                </div>
                {descriptions[it.type] && (
                  <div
                    className="text-[10px] text-dim mt-0.5"
                    data-testid={`${testIdPrefix}-desc-${it.type}`}
                  >
                    {descriptions[it.type]}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
