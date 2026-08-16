import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDown } from '@/components/ui/icons';
import type { ModelGroup, ModelInfo } from '@/utils/models';
import styles from './GroupedModelSelect.module.scss';

const VIEWPORT_MARGIN = 8;
const DROPDOWN_OFFSET = 6;
const DROPDOWN_MAX_HEIGHT = 320;

type GroupedModelSelectProps = {
  value: string;
  onChange: (value: string) => void;
  groups: ModelGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  customLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

type FlatOption = {
  value: string;
  label: string;
  group: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const matchesQuery = (model: ModelInfo, query: string) => {
  if (!query) return true;
  const haystack = `${model.name} ${model.alias ?? ''}`.toLowerCase();
  return haystack.includes(query);
};

export function GroupedModelSelect({
  value,
  onChange,
  groups,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  customLabel,
  disabled = false,
  ariaLabel,
}: GroupedModelSelectProps) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const isOpen = open && !disabled;

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => matchesQuery(item, normalized)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const flatOptions = useMemo<FlatOption[]>(() => {
    const options = filteredGroups.flatMap((group) =>
      group.items.map((item) => ({
        value: item.name,
        label: item.alias && item.alias !== item.name ? item.alias : item.name,
        group: group.label,
      }))
    );
    const trimmed = value.trim();
    if (trimmed && !options.some((option) => option.value === trimmed)) {
      return [{ value: trimmed, label: customLabel || trimmed, group: '' }, ...options];
    }
    return options;
  }, [customLabel, filteredGroups, value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const width = Math.min(rect.width, Math.max(240, window.innerWidth - VIEWPORT_MARGIN * 2));
    const left = clamp(rect.left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const openUp = spaceBelow < 220 && rect.top > spaceBelow;
    setDropdownStyle({
      position: 'fixed',
      left,
      width,
      zIndex: 2020,
      maxHeight: DROPDOWN_MAX_HEIGHT,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + DROPDOWN_OFFSET }
        : { top: rect.bottom + DROPDOWN_OFFSET }),
    });
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const selectValue = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((index) => Math.min(index + 1, Math.max(flatOptions.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      if (!isOpen) return;
      event.preventDefault();
      if (flatOptions[highlightedIndex]) {
        selectValue(flatOptions[highlightedIndex].value);
        return;
      }
      const custom = query.trim();
      if (custom) selectValue(custom);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        id={generatedId}
        type="button"
        className={`input ${styles.trigger}`}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className={value ? styles.value : styles.placeholder}>{value || placeholder}</span>
        <IconChevronDown size={16} className={styles.chevron} />
      </button>
      {isOpen &&
        dropdownStyle &&
        createPortal(
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            style={dropdownStyle}
            onKeyDown={handleKeyDown}
          >
            <input
              ref={searchRef}
              className={`input ${styles.search}`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              placeholder={searchPlaceholder}
            />
            <div className={styles.list}>
              {query.trim() &&
              !flatOptions.some((option) => option.value.toLowerCase() === query.trim().toLowerCase()) ? (
                <button
                  type="button"
                  className={`${styles.option} ${highlightedIndex < 0 ? styles.optionActive : ''}`}
                  onClick={() => selectValue(query.trim())}
                >
                  <span className={styles.optionName}>{query.trim()}</span>
                  <span className={styles.optionAlias}>{customLabel}</span>
                </button>
              ) : null}
              {flatOptions.length === 0 ? (
                <div className={styles.empty}>{emptyLabel}</div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.id} className={styles.group}>
                    <div className={styles.groupLabel}>{group.label}</div>
                    {group.items.map((item) => {
                      const optionIndex = flatOptions.findIndex((option) => option.value === item.name);
                      const active = optionIndex === highlightedIndex;
                      const selected = item.name === value;
                      return (
                        <button
                          key={`${group.id}-${item.name}`}
                          type="button"
                          className={`${styles.option} ${active ? styles.optionActive : ''} ${
                            selected ? styles.optionSelected : ''
                          }`}
                          onMouseEnter={() => setHighlightedIndex(optionIndex)}
                          onClick={() => selectValue(item.name)}
                        >
                          <span className={styles.optionName}>{item.name}</span>
                          {item.alias && item.alias !== item.name ? (
                            <span className={styles.optionAlias}>{item.alias}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
