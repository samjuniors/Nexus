'use client'

import {
  AudioLines,
  BookOpen,
  Camera,
  ChartColumn,
  Code2,
  Compass,
  FileText,
  Globe,
  Image as ImageIcon,
  Languages,
  Map,
  Palette,
  PenLine,
  Puzzle,
  Search,
  Sparkles,
  Target,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  palette: Palette,
  terminal: Terminal,
  camera: Camera,
  audio: AudioLines,
  book: BookOpen,
  languages: Languages,
  'file-text': FileText,
  puzzle: Puzzle,
  search: Search,
  pen: PenLine,
  chart: ChartColumn,
  image: ImageIcon,
  code: Code2,
  map: Map,
  target: Target,
  sparkles: Sparkles,
  wrench: Wrench,
  compass: Compass,
}

export function pluginIcon(name: string): LucideIcon {
  return ICONS[name] ?? Puzzle
}

export { Puzzle }
