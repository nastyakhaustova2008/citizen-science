import { METRICS } from '../data/metrics';

/**
 * Lab (campaign) editor model — roadmap step 5a.
 * The database enforces every rule (supabase/migrations/010_lab_editor.sql → lab_save,
 * lab_check_info, lab_check_fields and the structure guards). This file mirrors them so the
 * editor can show errors next to the inputs before saving: same paths, same codes.
 *
 * Error paths: info.<column>, fields.<i>.<prop>, fields.<i>.options.<j>.<prop>
 * (i, j = position in the editor). Codes → strings.js labs.errors.<code>.
 */

export const LANGS = ['he', 'en', 'ru'];
export const FIELD_TYPES = ['number', 'choice', 'multi_choice', 'text', 'boolean', 'datetime', 'photo'];
export const REGIONS = ['center', 'north', 'south', 'jerusalem', 'lowlands', 'haifa'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const LAB_STATUSES = ['collecting', 'completed'];
export const METRIC_KEYS = Object.keys(METRICS);

/** Icon names offered in the editor (components/ObsIcon.jsx knows all of them). */
export const LAB_ICONS = [
  'Thermometer', 'Building2', 'SunMedium', 'Sunrise', 'Droplets', 'CloudDrizzle', 'Moon', 'Stars',
  'Lightbulb', 'Wind', 'CloudFog', 'Snowflake', 'CloudRain', 'Waves', 'Leaf', 'TreePine', 'Flower2',
  'Sprout', 'Bird', 'Bug', 'Fish', 'Mountain', 'Volume2', 'FlaskConical', 'Microscope', 'Gauge', 'Activity',
];

export const LIMITS = {
  title: 120,
  desc: 1000,
  protocol: 8000,
  equipmentItems: 20,
  equipmentItem: 80,
  fieldLabel: 120,
  help: 500,
  optionLabel: 80,
  unit: 20,
  fields: 60,
  options: 50,
  slug: 60,
};

/** Built-in export columns (same list as the CHECK on campaign_fields.key, 004). */
const RESERVED_KEYS = [
  'id', 'campaign', 'metric', 'date', 'time', 'timestamp', 'place', 'school', 'lat', 'lng',
  'verification', 'form_version', 'value', 'unit', 'user', 'observation_id',
];
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const OPTION_KEY_RE = /^[a-z0-9][a-z0-9_]{0,39}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Same normalization as public.lab_line (one line) / lab_block (multi-line) in SQL. */
export const line = (s) => (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
export const block = (s) => (s ?? '').normalize('NFC').replace(/\r\n/g, '\n').trim();

const tri = (he = '', en = '', ru = '') => ({ he, en, ru });
let uidSeq = 0;
const uid = () => `u${++uidSeq}`;

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

function asciiWords(text) {
  return (text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function dedupe(base, taken, max = 40) {
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base.slice(0, max - String(n).length - 1)}_${n}`;
  return key;
}

/** Field key from the English label: "Water temp (°C)" → "water_temp_c". */
export function fieldKeyFromLabel(label, taken = []) {
  let key = asciiWords(label).join('_').slice(0, 40).replace(/_+$/, '');
  if (!key) key = 'field';
  if (!/^[a-z]/.test(key)) key = `f_${key}`.slice(0, 40);
  if (key.endsWith('_unit')) key = `${key.slice(0, -5)}_u`;
  if (RESERVED_KEYS.includes(key)) key = `${key}_value`;
  return dedupe(key, taken);
}

export function optionKeyFromLabel(label, taken = []) {
  const key = asciiWords(label).join('_').slice(0, 40).replace(/_+$/, '') || 'option';
  return dedupe(key, taken);
}

export function slugFromTitle(title, taken = []) {
  const base = asciiWords(title).join('-').slice(0, LIMITS.slug).replace(/-+$/, '') || `lab-${Date.now().toString(36)}`;
  let slug = base;
  for (let n = 2; taken.includes(slug); n += 1) slug = `${base.slice(0, LIMITS.slug - 4)}-${n}`;
  return slug;
}

/* ------------------------------------------------------------------ */
/* Editor state ↔ campaign / payload                                   */
/* ------------------------------------------------------------------ */

export function emptyField(type = 'text') {
  return {
    uid: uid(),
    saved: false,
    keyEdited: false,
    key: '',
    type,
    label: tri(),
    help: tri(),
    required: false,
    archived: false,
    isPrimary: false,
    unit: '',
    min: '',
    max: '',
    decimals: type === 'number' ? 1 : null,
    textLong: false,
    options: [],
  };
}

export function emptyOption() {
  return { uid: uid(), saved: false, keyEdited: false, key: '', label: tri(), archived: false };
}

export function emptyLab() {
  return {
    id: null,
    editNo: null,
    publication: 'draft',
    slug: '',
    slugEdited: false,
    icon: 'Activity',
    region: 'center',
    difficulty: 'easy',
    status: 'collecting',
    metric: '',
    center: null,
    zoom: 8,
    title: tri(),
    desc: tri(),
    equipment: { he: [], en: [], ru: [] },
    protocol: tri(),
    fields: [],
  };
}

/** A campaign from AppDataContext (campaignFromRow) → editor state. */
export function labFromCampaign(c) {
  return {
    id: c.id,
    editNo: c.editNo,
    publication: c.publication,
    slug: c.slug,
    slugEdited: true,
    icon: c.icon || 'Activity',
    region: c.region,
    difficulty: c.difficulty,
    status: c.status,
    metric: c.metric || '',
    center: c.centerSet ? [...c.center] : null,
    zoom: c.zoom,
    title: tri(c.titleHe, c.titleEn, c.titleRu),
    desc: tri(c.descHe, c.descEn, c.descRu),
    equipment: { he: [...c.equipmentHe], en: [...c.equipmentEn], ru: [...c.equipmentRu] },
    protocol: tri(c.protocolHe, c.protocolEn, c.protocolRu),
    fields: c.fields.map((f) => ({
      uid: uid(),
      saved: true,
      keyEdited: true,
      key: f.key,
      type: f.type,
      label: tri(f.labelHe, f.labelEn, f.labelRu),
      help: tri(f.helpHe, f.helpEn, f.helpRu),
      required: f.required,
      archived: f.archived,
      isPrimary: f.isPrimary,
      unit: f.unit || '',
      min: f.min ?? '',
      max: f.max ?? '',
      decimals: f.decimals,
      textLong: f.textLong,
      options: f.options.map((o) => ({
        uid: uid(),
        saved: true,
        keyEdited: true,
        key: o.key,
        label: tri(o.labelHe, o.labelEn, o.labelRu),
        archived: o.archived,
      })),
    })),
  };
}

const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/** Editor state → lab_save arguments. */
export function labToPayload(lab) {
  const info = {
    slug: lab.slug,
    icon: lab.icon,
    region: lab.region,
    difficulty: lab.difficulty,
    status: lab.status,
    metric: lab.metric || null,
    center_lat: lab.center ? lab.center[0] : null,
    center_lng: lab.center ? lab.center[1] : null,
    zoom: lab.zoom,
  };
  for (const l of LANGS) {
    info[`title_${l}`] = lab.title[l];
    info[`desc_${l}`] = lab.desc[l];
    info[`protocol_${l}`] = lab.protocol[l];
    info[`equipment_${l}`] = lab.equipment[l];
  }
  const fields = lab.fields.map((f) => {
    const number = f.type === 'number';
    const choice = f.type === 'choice' || f.type === 'multi_choice';
    const out = {
      key: f.key,
      type: f.type,
      required: f.required,
      archived: f.archived,
      is_primary: number && f.isPrimary,
      text_long: f.type === 'text' && f.textLong,
      unit: number ? line(f.unit) || null : null,
      min_value: number ? numOrNull(f.min) : null,
      max_value: number ? numOrNull(f.max) : null,
      decimals: number ? f.decimals : null,
      options: choice
        ? f.options.map((o) => ({
            key: o.key,
            archived: o.archived,
            label_he: o.label.he,
            label_en: o.label.en,
            label_ru: o.label.ru,
          }))
        : [],
    };
    for (const l of LANGS) {
      out[`label_${l}`] = f.label[l];
      out[`help_${l}`] = f.help[l];
    }
    return out;
  });
  return { info, fields };
}

/* ------------------------------------------------------------------ */
/* Validation (mirrors lab_check_info / lab_check_fields)              */
/* ------------------------------------------------------------------ */

/**
 * {path: code} for the editor state. strict = not a draft (texts required).
 * Only checks what the database checks; the submit checklist (5b) adds more.
 */
export function validateLab(lab, { strict = false } = {}) {
  const errs = {};
  const { info, fields } = labToPayload(lab);

  if (!info.slug) errs['info.slug'] = 'required';
  else if (info.slug.length > LIMITS.slug || !SLUG_RE.test(info.slug)) errs['info.slug'] = 'format';
  if (!REGIONS.includes(info.region)) errs['info.region'] = 'invalid';
  if (!DIFFICULTIES.includes(info.difficulty)) errs['info.difficulty'] = 'invalid';
  if (!LAB_STATUSES.includes(info.status)) errs['info.status'] = 'invalid';
  if (info.center_lat == null) {
    if (strict) errs['info.center'] = 'required';
  } else if (Math.abs(info.center_lat) > 90 || Math.abs(info.center_lng) > 180) {
    errs['info.center'] = 'invalid';
  }

  for (const l of LANGS) {
    const title = line(info[`title_${l}`]);
    if (!title) {
      if (strict) errs[`info.title_${l}`] = 'required';
    } else if (title.length > LIMITS.title) errs[`info.title_${l}`] = 'too_long';

    const desc = block(info[`desc_${l}`]);
    if (!desc) {
      if (strict) errs[`info.desc_${l}`] = 'required';
    } else if (desc.length > LIMITS.desc) errs[`info.desc_${l}`] = 'too_long';

    if (block(info[`protocol_${l}`]).length > LIMITS.protocol) errs[`info.protocol_${l}`] = 'too_long';

    const items = info[`equipment_${l}`].map(line).filter(Boolean);
    if (items.some((x) => x.length > LIMITS.equipmentItem)) errs[`info.equipment_${l}`] = 'too_long';
    else if (items.length > LIMITS.equipmentItems) errs[`info.equipment_${l}`] = 'too_many';
  }

  if (fields.length > LIMITS.fields) errs.fields = 'too_many';
  const keys = [];
  let primaries = 0;
  fields.forEach((f, i) => {
    const p = `fields.${i}.`;
    if (!FIELD_KEY_RE.test(f.key) || f.key.endsWith('_unit')) errs[`${p}key`] = 'format';
    else if (RESERVED_KEYS.includes(f.key)) errs[`${p}key`] = 'reserved';
    else if (keys.includes(f.key)) errs[`${p}key`] = 'duplicate';
    keys.push(f.key);

    for (const l of LANGS) {
      const label = line(f[`label_${l}`]);
      if (!label) {
        if (strict) errs[`${p}label_${l}`] = 'required';
      } else if (label.length > LIMITS.fieldLabel) errs[`${p}label_${l}`] = 'too_long';
      if (line(f[`help_${l}`]).length > LIMITS.help) errs[`${p}help_${l}`] = 'too_long';
    }

    if (f.type === 'number') {
      if (!Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 6) errs[`${p}decimals`] = 'invalid';
      if (Number.isNaN(f.min_value)) errs[`${p}min_value`] = 'invalid';
      else if (Number.isNaN(f.max_value)) errs[`${p}max_value`] = 'invalid';
      else if (f.min_value != null && f.max_value != null && f.min_value > f.max_value) errs[`${p}max_value`] = 'min_max';
      if ((f.unit || '').length > LIMITS.unit) errs[`${p}unit`] = 'too_long';
    }

    if (f.is_primary) {
      primaries += 1;
      if (f.archived) errs[`${p}is_primary`] = 'invalid';
      else if (primaries > 1) errs[`${p}is_primary`] = 'multiple';
    }

    if (f.options.length > LIMITS.options) errs[`${p}options`] = 'too_many';
    const okeys = [];
    f.options.forEach((o, j) => {
      const q = `${p}options.${j}.`;
      if (!OPTION_KEY_RE.test(o.key)) errs[`${q}key`] = 'format';
      else if (okeys.includes(o.key)) errs[`${q}key`] = 'duplicate';
      okeys.push(o.key);
      for (const l of LANGS) {
        const label = line(o[`label_${l}`]);
        if (!label) {
          if (strict) errs[`${q}label_${l}`] = 'required';
        } else if (label.length > LIMITS.optionLabel) errs[`${q}label_${l}`] = 'too_long';
      }
    });
  });
  return errs;
}

/* ------------------------------------------------------------------ */
/* Published labs: what counts as structural (mirrors the SQL guards)  */
/* ------------------------------------------------------------------ */

/**
 * Structural differences between the saved lab and the editor state (empty = cosmetic only).
 * Structural: fields / options added or removed, archive, required, primary, min / max /
 * decimals, text length, protocol. Returns a list of {kind, key} for the message.
 */
export function structuralChanges(saved, lab) {
  const out = [];
  if (LANGS.some((l) => block(saved.protocol[l]) !== block(lab.protocol[l]))) out.push({ kind: 'protocol' });
  const before = new Map(saved.fields.map((f) => [f.key, f]));
  const nums = (f) => [numOrNull(f.min), numOrNull(f.max), f.decimals].join('|');
  for (const f of lab.fields) {
    const old = before.get(f.key);
    if (!old || !f.saved) {
      out.push({ kind: 'fieldAdded', key: f.key });
      continue;
    }
    before.delete(f.key);
    if (
      old.required !== f.required ||
      old.archived !== f.archived ||
      old.isPrimary !== f.isPrimary ||
      old.textLong !== f.textLong ||
      (f.type === 'number' && nums(old) !== nums(f))
    ) {
      out.push({ kind: 'fieldChanged', key: f.key });
    }
    const oldOpts = new Map(old.options.map((o) => [o.key, o]));
    for (const o of f.options) {
      const oo = oldOpts.get(o.key);
      if (!oo || !o.saved) out.push({ kind: 'optionAdded', key: `${f.key}.${o.key}` });
      else if (oo.archived !== o.archived) out.push({ kind: 'optionChanged', key: `${f.key}.${o.key}` });
      oldOpts.delete(o.key);
    }
    for (const k of oldOpts.keys()) out.push({ kind: 'optionRemoved', key: `${f.key}.${k}` });
  }
  for (const k of before.keys()) out.push({ kind: 'fieldRemoved', key: k });
  return out;
}

/** A field turned into what the form engine (src/lib/fields.js, FieldInput) expects — for the preview. */
export function previewField(f) {
  const { fields } = labToPayload({ ...emptyLab(), fields: [f] });
  const p = fields[0];
  return {
    key: f.key || f.uid,
    type: f.type,
    labelHe: f.label.he,
    labelEn: f.label.en,
    labelRu: f.label.ru,
    helpHe: f.help.he,
    helpEn: f.help.en,
    helpRu: f.help.ru,
    required: f.required,
    archived: f.archived,
    isPrimary: p.is_primary,
    unit: p.unit,
    min: Number.isFinite(p.min_value) ? p.min_value : null,
    max: Number.isFinite(p.max_value) ? p.max_value : null,
    decimals: p.decimals,
    textLong: p.text_long,
    options: f.options.map((o, j) => ({
      key: o.key || o.uid,
      labelHe: o.label.he,
      labelEn: o.label.en,
      labelRu: o.label.ru,
      sortOrder: j,
      archived: o.archived,
    })),
  };
}

/** Localized equipment list with the Hebrew fallback (old labs had Hebrew only). */
export function labEquipment(c, locale) {
  if (!c) return [];
  if (locale === 'en' && c.equipmentEn?.length) return c.equipmentEn;
  if (locale === 'ru' && c.equipmentRu?.length) return c.equipmentRu;
  return c.equipmentHe?.length ? c.equipmentHe : c.equipment || [];
}

/** Localized protocol (Markdown) or '' → the generic steps from strings.js. */
export function labProtocol(c, locale) {
  if (!c) return '';
  if (locale === 'en' && c.protocolEn) return c.protocolEn;
  if (locale === 'ru' && c.protocolRu) return c.protocolRu;
  return c.protocolHe || '';
}
