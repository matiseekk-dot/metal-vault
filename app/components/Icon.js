// ── Icon — centralized lucide-react wrapper ───────────────────────────────
// Single source of truth for all icons used in the app. Named by semantic
// role (not visual), so swapping the underlying icon later is a single edit.
'use client';
import {
  // Collection / records
  Package, Disc3, Album, Library, Archive,
  // Actions
  Plus, PlusCircle, Trash2, Edit3, RefreshCw, Share2, Download, Upload,
  ExternalLink, Copy, Search, Filter, X, Check, ChevronDown, ChevronUp,
  ChevronRight, ChevronLeft, MoreHorizontal, Settings,
  // Status / alerts
  Bell, BellRing, BellOff, AlertCircle, AlertTriangle, CheckCircle2,
  Info, Flame, Star, Heart,
  // Money / stats
  TrendingUp, TrendingDown, DollarSign, BarChart3, PieChart, LineChart,
  Wallet, Coins, Gem, Crown,
  // Media
  Music2, Music, Headphones, Radio, Camera, Image as ImageIcon,
  // Auth / user
  User, UserPlus, LogIn, LogOut, Mail, Globe, Shield, Lock,
  // Navigation
  Home, Calendar, MapPin, Tag, Layers,
  // Misc
  Sparkles, Zap, Rocket, Crosshair, FileText, Shirt, Award,
  Scan, BarcodeIcon,
} from 'lucide-react';

// Semantic mapping — swap the implementation without touching callsites
export const I = {
  // Collection
  record:      Disc3,         // single vinyl record
  collection:  Library,       // full collection / vault
  pkg:         Package,       // generic "records" bucket
  addRecord:   PlusCircle,    // add new record

  // Actions
  add:         Plus,
  edit:        Edit3,
  delete:      Trash2,
  refresh:     RefreshCw,
  share:       Share2,
  download:    Download,
  upload:      Upload,
  external:    ExternalLink,
  copy:        Copy,
  search:      Search,
  filter:      Filter,
  close:       X,
  check:       Check,
  chevronD:    ChevronDown,
  chevronU:    ChevronUp,
  chevronR:    ChevronRight,
  chevronL:    ChevronLeft,
  more:        MoreHorizontal,
  settings:    Settings,

  // Status
  bell:        Bell,
  bellOn:      BellRing,
  bellOff:     BellOff,
  alert:       AlertCircle,
  warning:     AlertTriangle,
  success:     CheckCircle2,
  info:        Info,
  fire:        Flame,            // streaks
  star:        Star,             // watchlist / favorite
  heart:       Heart,            // wanted / love

  // Money
  up:          TrendingUp,
  down:        TrendingDown,
  dollar:      DollarSign,
  barChart:    BarChart3,
  pieChart:    PieChart,
  lineChart:   LineChart,
  wallet:      Wallet,
  coins:       Coins,
  gem:         Gem,              // Pro feature / rare
  crown:       Crown,            // crown jewel / persona

  // Media
  music:       Music2,
  musicAlt:    Music,
  headphones:  Headphones,
  radio:       Radio,
  camera:      Camera,
  image:       ImageIcon,

  // Auth
  user:        User,
  userAdd:     UserPlus,
  login:       LogIn,
  logout:      LogOut,
  mail:        Mail,
  globe:       Globe,            // language picker
  shield:      Shield,           // insurance (alias)
  lock:        Lock,

  // Navigation
  home:        Home,
  calendar:    Calendar,
  location:    MapPin,
  tag:         Tag,
  layers:      Layers,

  // Misc
  sparkles:    Sparkles,
  zap:         Zap,              // quick action
  rocket:      Rocket,            // early access
  target:      Crosshair,         // achievements
  file:        FileText,          // insurance report
  apparel:     Shirt,
  award:       Award,
  scan:        Scan,              // barcode
  barcode:     BarcodeIcon,

  // Aliases for semantic clarity
  insurance:   FileText,
  detailedGrading: Gem,
  priceHistory:    LineChart,
  marketIntel:     TrendingUp,
  bulkOps:         Layers,
  earlyAccess:     Rocket,
  priority:        Crosshair,
  export:          Download,
  proLabel:        Crown,
};

// Convenience component — <Icon name="fire" size={16} color="#f5c842" />
export default function Icon({ name, size = 16, color, strokeWidth = 2, style, ...rest }) {
  const Component = I[name];
  if (!Component) {
    console.warn('[Icon] unknown name:', name);
    return null;
  }
  return (
    <Component
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      style={{ flexShrink: 0, ...style }}
      {...rest}
    />
  );
}
