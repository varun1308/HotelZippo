/* FamilyProfileForm — the structured-form alternative to conversational onboarding
 * (Phase 3d). Values mined from design_handoff/Family Profile Form.html against the
 * LOCKED tokens.
 *
 * Hard rules honoured here:
 *   • Amber/red are reserved for hard-flag alerts. The ONE sanctioned non-hard-flag
 *     use of red is a FORM FIELD validation error (border-flag-red / text-flag-red-text
 *     / bg-flag-red-bg) — used only on the required "name" field when empty on submit.
 *   • Every interactive control is keyboard-operable with a focus-visible primary ring.
 *   • Decorative motion (toggle knob, active scale) is gated via motion-reduce.
 *   • Missing-image rules / streaming rules don't apply — this is a pure input form.
 *
 * The three food toggles collapse into the single `food` enum on submit; vegan implies
 * vegetarian. Children with an empty name or non-finite age are dropped from output.
 */
'use client';

import { useId, useRef, useState } from 'react';
import {
  MessageCircle,
  ClipboardList,
  User,
  Users,
  Trash2,
  Plus,
  Utensils,
  Wallet,
  CircleDollarSign,
  Gem,
  Crown,
  BadgeCheck,
  Sparkles,
  AlertCircle,
  Check,
} from 'lucide-react';
import type { FamilyProfile } from './types';

type BudgetTier = FamilyProfile['budgetTier'];

const BRANDS = ['Marriott Bonvoy', 'Hilton Honors', 'IHG One Rewards'] as const;
const NO_PREFERENCE = 'No preference';

const BUDGET_OPTIONS: {
  value: BudgetTier;
  label: string;
  desc: string;
  Icon: typeof CircleDollarSign;
}[] = [
  { value: 'value', label: 'Value', desc: 'Smart, dependable stays', Icon: CircleDollarSign },
  { value: 'comfort', label: 'Comfort', desc: 'A step up, room to relax', Icon: Gem },
  { value: 'luxury', label: 'Luxury', desc: 'The best the place offers', Icon: Crown },
];

/* A single child row in local form state. Age is kept as raw string so the input
 * stays controlled and empty-able; it's parsed/filtered only at submit. */
interface ChildRow {
  id: string;
  name: string;
  age: string;
}

export interface FamilyProfileFormProps {
  onSubmit: (profile: FamilyProfile) => void;
  onBack: () => void;
  initial?: Partial<FamilyProfile>;
}

/* ---- small presentational primitives ------------------------------------- */

function SectionTitle({
  Icon,
  children,
}: {
  Icon: typeof User;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-[10px] text-[13px] font-semibold tracking-[0.02em] text-text">
      <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-primary-50 text-primary-600">
        <Icon aria-hidden className="h-[15px] w-[15px]" strokeWidth={1.75} />
      </span>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-[22px] shadow-sm">
      {children}
    </div>
  );
}

/* Accessible toggle switch — a real role=switch button. */
function ToggleSwitch({
  checked,
  onChange,
  label,
  sub,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  sub: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-[13px] last:border-b-0">
      <div>
        <div className="text-[14.5px] font-medium text-text">{label}</div>
        <div className="mt-[2px] text-[12.5px] text-text-tertiary">{sub}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-[27px] w-[46px] flex-none rounded-pill transition-colors duration-base',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-70',
          checked ? 'bg-primary-500' : 'bg-surface-3',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'absolute top-[3px] left-[3px] h-[21px] w-[21px] rounded-full bg-white shadow-sm',
            'transition-transform duration-base ease-out motion-reduce:transition-none',
            checked ? 'translate-x-[19px]' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

/* ---- the form ------------------------------------------------------------ */

export function FamilyProfileForm({
  onSubmit,
  onBack,
  initial,
}: FamilyProfileFormProps): JSX.Element {
  const uid = useId();
  const nameId = `${uid}-name`;
  const nameErrId = `${uid}-name-err`;
  const homeId = `${uid}-home`;
  const notesId = `${uid}-notes`;

  const nameRef = useRef<HTMLInputElement>(null);

  // Derive initial food toggles from the collapsed enum.
  const initialFood = initial?.food;
  const [name, setName] = useState(initial?.name ?? '');
  const [hometown, setHometown] = useState(initial?.hometown ?? '');
  const [spouse, setSpouse] = useState(initial?.spouse ?? true);
  const [children, setChildren] = useState<ChildRow[]>(() =>
    (initial?.children ?? []).map((c, i) => ({
      id: `init-${i}`,
      name: c.name,
      age: Number.isFinite(c.age) ? String(c.age) : '',
    })),
  );
  const [vegetarian, setVegetarian] = useState(
    initialFood === 'vegetarian' || initialFood === 'vegan',
  );
  const [vegan, setVegan] = useState(initialFood === 'vegan');
  const [indianFoodMatters, setIndianFoodMatters] = useState(
    initial?.indianFoodMatters ?? false,
  );
  const [budgetTier, setBudgetTier] = useState<BudgetTier>(
    initial?.budgetTier ?? 'comfort',
  );
  const [brands, setBrands] = useState<string[]>(initial?.brandPreferences ?? []);
  const [noPreference, setNoPreference] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const [nameError, setNameError] = useState(false);

  const rowSeq = useRef(0);

  function addChild() {
    rowSeq.current += 1;
    setChildren((prev) => [
      ...prev,
      { id: `row-${rowSeq.current}`, name: '', age: '' },
    ]);
  }

  function removeChild(id: string) {
    setChildren((prev) => prev.filter((c) => c.id !== id));
  }

  function updateChild(id: string, patch: Partial<Pick<ChildRow, 'name' | 'age'>>) {
    setChildren((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  // Vegan implies vegetarian: turning vegan ON forces veg ON; veg can't be turned off
  // while vegan is on.
  function setVeganToggle(next: boolean) {
    setVegan(next);
    if (next) setVegetarian(true);
  }
  function setVegetarianToggle(next: boolean) {
    if (vegan) return; // locked on while vegan
    setVegetarian(next);
  }

  function toggleBrand(brand: string) {
    setNoPreference(false);
    setBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand],
    );
  }

  function selectNoPreference() {
    const next = !noPreference;
    setNoPreference(next);
    if (next) setBrands([]);
  }

  function collapseFood(): FamilyProfile['food'] {
    if (vegan) return 'vegan';
    if (vegetarian) return 'vegetarian';
    return 'none';
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }

    const cleanedChildren = children
      .map((c) => ({ name: c.name.trim(), age: Number(c.age) }))
      .filter((c) => c.name !== '' && c.age !== null && Number.isFinite(c.age))
      .map((c) => ({ name: c.name, age: c.age }));

    const trimmedHome = hometown.trim();
    const trimmedNotes = notes.trim();

    const profile: FamilyProfile = {
      name: trimmedName,
      hometown: trimmedHome === '' ? null : trimmedHome,
      spouse,
      children: cleanedChildren,
      food: collapseFood(),
      indianFoodMatters,
      budgetTier,
      brandPreferences: noPreference ? [] : brands,
      notes: trimmedNotes === '' ? null : trimmedNotes,
    };

    onSubmit(profile);
  }

  return (
    <div className="min-h-[100dvh] bg-bg">
      {/* top bar */}
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-bg/[0.86] px-6 backdrop-blur-[10px]">
        <div className="flex items-baseline gap-[9px]">
          <span
            aria-hidden
            className="h-3 w-3 rotate-45 rounded-[3px] bg-primary-500"
          />
          <span className="font-serif text-[21px] font-semibold tracking-[-0.02em] text-text">
            Hotel<b className="font-semibold text-primary-600">Zippo</b>
          </span>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-[38px] items-center gap-2 rounded-btn border border-border bg-surface px-[14px] text-[14px] font-medium text-text shadow-xs hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <MessageCircle aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          Back to chat
        </button>
      </header>

      <main className="mx-auto w-full max-w-[660px] px-6 pb-16 pt-10">
        <div className="mb-[34px]">
          <div className="mb-[14px] inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-primary-600">
            <ClipboardList aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
            Family profile
          </div>
          <h1 className="mb-3 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.02em] text-text">
            Tell me about your family
          </h1>
          <p className="max-w-[52ch] text-[16px] leading-[1.6] text-text-secondary">
            Fill this in once and I&rsquo;ll remember it for every trip — no need to
            repeat yourself.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* ABOUT YOU */}
          <section className="mb-[30px]">
            <SectionTitle Icon={User}>About you</SectionTitle>
            <Card>
              <div className="mb-[18px]">
                <label
                  htmlFor={nameId}
                  className="mb-2 flex items-center gap-[7px] text-[13.5px] font-semibold text-text"
                >
                  Your name <span className="text-primary-500">*</span>
                </label>
                <input
                  ref={nameRef}
                  id={nameId}
                  type="text"
                  value={name}
                  placeholder="e.g. Varun"
                  aria-required="true"
                  aria-invalid={nameError}
                  aria-describedby={nameError ? nameErrId : undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError && e.target.value.trim() !== '') setNameError(false);
                  }}
                  className={[
                    'w-full rounded-input border bg-surface px-[14px] py-3 text-[15px] text-text',
                    'placeholder:text-text-tertiary transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    nameError
                      ? 'border-flag-red bg-flag-red-bg focus-visible:border-flag-red'
                      : 'border-border-strong focus-visible:border-primary-400',
                  ].join(' ')}
                />
                {nameError && (
                  <div
                    id={nameErrId}
                    className="mt-[7px] flex items-center gap-[6px] text-[12.5px] text-flag-red-text"
                  >
                    <AlertCircle aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
                    Please add your name
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor={homeId}
                  className="mb-2 flex items-center gap-[7px] text-[13.5px] font-semibold text-text"
                >
                  Hometown{' '}
                  <span className="text-[12px] font-normal text-text-tertiary">
                    — optional
                  </span>
                </label>
                <input
                  id={homeId}
                  type="text"
                  value={hometown}
                  placeholder="e.g. Mumbai"
                  onChange={(e) => setHometown(e.target.value)}
                  className="w-full rounded-input border border-border-strong bg-surface px-[14px] py-3 text-[15px] text-text placeholder:text-text-tertiary transition-colors duration-fast focus-visible:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            </Card>
          </section>

          {/* WHO'S TRAVELLING */}
          <section className="mb-[30px]">
            <SectionTitle Icon={Users}>Who&rsquo;s travelling</SectionTitle>
            <Card>
              <div className="mb-[18px] flex items-center justify-between gap-4 rounded-input border border-border-strong px-[15px] py-[13px]">
                <div>
                  <div className="text-[14.5px] font-medium text-text">
                    Travelling with a partner / spouse
                  </div>
                  <div className="mt-[2px] text-[12.5px] text-text-tertiary">
                    Counts toward room and occupancy planning.
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={spouse}
                  aria-label="Travelling with a partner / spouse"
                  onClick={() => setSpouse((s) => !s)}
                  className={[
                    'relative h-[27px] w-[46px] flex-none rounded-pill transition-colors duration-base',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    spouse ? 'bg-primary-500' : 'bg-surface-3',
                  ].join(' ')}
                >
                  <span
                    aria-hidden
                    className={[
                      'absolute top-[3px] left-[3px] h-[21px] w-[21px] rounded-full bg-white shadow-sm',
                      'transition-transform duration-base ease-out motion-reduce:transition-none',
                      spouse ? 'translate-x-[19px]' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
              </div>

              <div>
                <span className="mb-2 block text-[13.5px] font-semibold text-text">
                  Children{' '}
                  <span className="text-[12px] font-normal text-text-tertiary">
                    — ages help me plan pools, clubs &amp; cots
                  </span>
                </span>

                {children.length > 0 && (
                  <ul className="flex flex-col gap-3">
                    {children.map((child) => (
                      <li
                        key={child.id}
                        className="flex flex-wrap items-end gap-3 sm:flex-nowrap"
                      >
                        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                          <label
                            htmlFor={`${child.id}-name`}
                            className="mb-[7px] block text-[12px] font-semibold text-text-secondary"
                          >
                            Child
                          </label>
                          <input
                            id={`${child.id}-name`}
                            type="text"
                            value={child.name}
                            placeholder="Name or nickname"
                            onChange={(e) =>
                              updateChild(child.id, { name: e.target.value })
                            }
                            className="w-full rounded-input border border-border-strong bg-surface px-[14px] py-3 text-[15px] text-text placeholder:text-text-tertiary transition-colors duration-fast focus-visible:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                        </div>
                        <div className="w-[96px] flex-none">
                          <label
                            htmlFor={`${child.id}-age`}
                            className="mb-[7px] block text-[12px] font-semibold text-text-secondary"
                          >
                            Age
                          </label>
                          <input
                            id={`${child.id}-age`}
                            type="number"
                            min={0}
                            max={17}
                            value={child.age}
                            placeholder="7"
                            onChange={(e) =>
                              updateChild(child.id, { age: e.target.value })
                            }
                            className="w-full rounded-input border border-border-strong bg-surface px-[14px] py-3 text-[15px] text-text placeholder:text-text-tertiary transition-colors duration-fast focus-visible:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Remove child"
                          onClick={() => removeChild(child.id)}
                          className="grid h-11 w-11 flex-none place-items-center rounded-input border border-border bg-surface text-text-tertiary transition-colors duration-fast hover:border-border-strong hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Trash2 aria-hidden className="h-[17px] w-[17px]" strokeWidth={1.75} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={addChild}
                  className="mt-[14px] inline-flex h-[42px] items-center gap-2 rounded-btn border border-dashed border-border-strong bg-surface px-4 text-[14px] font-semibold text-text transition-colors duration-fast hover:border-primary-100 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Plus aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                  Add a child
                </button>
              </div>
            </Card>
          </section>

          {/* FOOD */}
          <section className="mb-[30px]">
            <SectionTitle Icon={Utensils}>Food preferences</SectionTitle>
            <Card>
              <ToggleSwitch
                checked={vegetarian}
                onChange={setVegetarianToggle}
                disabled={vegan}
                label="Vegetarian"
                sub="Prioritise reliable vegetarian options"
              />
              <ToggleSwitch
                checked={vegan}
                onChange={setVeganToggle}
                label="Vegan"
                sub="Stricter — no dairy or animal products"
              />
              <ToggleSwitch
                checked={indianFoodMatters}
                onChange={setIndianFoodMatters}
                label="Indian food matters"
                sub="Weight hotels with a strong Indian spread"
              />
            </Card>
          </section>

          {/* BUDGET */}
          <section className="mb-[30px]">
            <SectionTitle Icon={Wallet}>Budget tier</SectionTitle>
            <div
              role="radiogroup"
              aria-label="Budget tier"
              className="grid grid-cols-1 gap-[10px] sm:grid-cols-3"
            >
              {BUDGET_OPTIONS.map(({ value, label, desc, Icon }) => {
                const selected = budgetTier === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setBudgetTier(value)}
                    className={[
                      'h-full rounded-input border px-[14px] py-[15px] text-left transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selected
                        ? 'border-primary-500 bg-primary-50 ring-2 ring-primary'
                        : 'border-border-strong hover:bg-surface-2',
                    ].join(' ')}
                  >
                    <span className="mb-1 flex items-center gap-2 text-[14.5px] font-semibold text-text">
                      <Icon
                        aria-hidden
                        className={[
                          'h-4 w-4',
                          selected ? 'text-primary-600' : 'text-text-tertiary',
                        ].join(' ')}
                        strokeWidth={1.75}
                      />
                      {label}
                    </span>
                    <span className="block text-[12px] leading-[1.4] text-text-tertiary">
                      {desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* BRANDS */}
          <section className="mb-[30px]">
            <SectionTitle Icon={BadgeCheck}>
              Loyalty programmes{' '}
              <span className="font-normal text-text-tertiary">— optional</span>
            </SectionTitle>
            <div className="flex flex-wrap gap-[10px]">
              {BRANDS.map((brand) => {
                const selected = brands.includes(brand);
                return (
                  <button
                    key={brand}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleBrand(brand)}
                    className={[
                      'inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border px-[15px] py-[10px] text-[14px] font-medium transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selected
                        ? 'border-primary-500 bg-primary-50 text-primary-800'
                        : 'border-border-strong text-text hover:bg-surface-2',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden
                      className={[
                        'grid h-4 w-4 place-items-center rounded-full border transition-colors duration-fast',
                        selected
                          ? 'border-primary-500 bg-primary-500'
                          : 'border-border-strong',
                      ].join(' ')}
                    >
                      {selected && (
                        <Check className="h-[11px] w-[11px] text-white" strokeWidth={2.5} />
                      )}
                    </span>
                    {brand}
                  </button>
                );
              })}
              <button
                type="button"
                role="checkbox"
                aria-checked={noPreference}
                onClick={selectNoPreference}
                className={[
                  'inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border px-[15px] py-[10px] text-[14px] font-medium transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  noPreference
                    ? 'border-primary-500 bg-primary-50 text-primary-800'
                    : 'border-border-strong text-text hover:bg-surface-2',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'grid h-4 w-4 place-items-center rounded-full border transition-colors duration-fast',
                    noPreference
                      ? 'border-primary-500 bg-primary-500'
                      : 'border-border-strong',
                  ].join(' ')}
                >
                  {noPreference && (
                    <Check className="h-[11px] w-[11px] text-white" strokeWidth={2.5} />
                  )}
                </span>
                {NO_PREFERENCE}
              </button>
            </div>
          </section>

          {/* NOTES */}
          <section className="mb-[30px]">
            <SectionTitle Icon={Sparkles}>
              Anything else{' '}
              <span className="font-normal text-text-tertiary">— optional</span>
            </SectionTitle>
            <Card>
              <label
                htmlFor={notesId}
                className="mb-2 block text-[13.5px] font-semibold text-text"
              >
                Freestyle notes
              </label>
              <textarea
                id={notesId}
                value={notes}
                placeholder="The little things that make a trip yours — favourite spots, must-haves, or things to avoid."
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[92px] w-full resize-y rounded-input border border-border-strong bg-surface px-[14px] py-3 text-[15px] leading-[1.55] text-text placeholder:text-text-tertiary transition-colors duration-fast focus-visible:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </Card>
          </section>

          {/* FOOTER */}
          <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <button
              type="submit"
              className="inline-flex h-[52px] flex-none items-center justify-center gap-[9px] rounded-btn bg-primary-500 px-7 text-[15.5px] font-semibold text-on-primary shadow-md transition-colors duration-fast hover:bg-primary-600 active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Check aria-hidden className="h-[18px] w-[18px]" strokeWidth={2} />
              Save profile
            </button>
            <span className="text-[13px] leading-[1.45] text-text-tertiary">
              You can change any of this later.
            </span>
          </div>
        </form>
      </main>
    </div>
  );
}
