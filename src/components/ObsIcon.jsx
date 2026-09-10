import {
  Thermometer,
  Building2,
  SunMedium,
  Sunrise,
  Droplets,
  CloudDrizzle,
  Moon,
  Sparkles,
  Lightbulb,
  Wind,
  CloudFog,
  Snowflake,
  Activity,
} from 'lucide-react';

const MAP = {
  Thermometer,
  Building2,
  SunMedium,
  Sunrise,
  Droplets,
  CloudDrizzle,
  Moon,
  Stars: Sparkles,
  Lightbulb,
  Wind,
  CloudFog,
  Snowflake,
};

export default function ObsIcon({ name, className = 'h-5 w-5', strokeWidth = 1.75 }) {
  const Cmp = MAP[name] || Activity;
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
