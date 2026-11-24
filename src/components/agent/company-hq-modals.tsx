'use client'

import { useState } from 'react'
import {
  Building2,
  FileText,
  FolderGit2,
  Globe,
  Layers,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type {
  CompanyStage,
  ProductKind,
  ProductStage,
} from '@/lib/agent/company-types'

export function NewCompanyDialog({
  open,
  onOpenChange,
  busy,
  onCreate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  busy: boolean
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('SaaS & Digital Products')
  const [stage, setStage] = useState<CompanyStage>('early')
  const [mission, setMission] = useState('')
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState('250')
  const [founderApprovalRequired, setFounderApprovalRequired] = useState(true)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const ok = await onCreate({
      action: 'create_company',
      companyName: name.trim(),
      industry: industry.trim(),
      stage,
      mission: mission.trim(),
      monthlyBudgetUsd: Number(monthlyBudgetUsd) || 250,
      founderApprovalRequired,
    })
    if (ok) {
      setName('')
      setMission('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Create New Company
          </DialogTitle>
          <DialogDescription>
            Register an isolated company led by Eva as CEO reporting to you as Founder. You can attach multiple products or projects underneath.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cmp-name">Company Name</Label>
              <Input
                id="cmp-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Lumina Health, Apex Studio"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-industry">Industry / Business Model</Label>
              <Input
                id="cmp-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g., B2B SaaS, E-Commerce, Agency"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cmp-stage">Company Stage</Label>
              <select
                id="cmp-stage"
                value={stage}
                onChange={(e) => setStage(e.target.value as CompanyStage)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="idea">Idea / Validation</option>
                <option value="early">Early Traction</option>
                <option value="growth">Growth</option>
                <option value="scale">Scale / Enterprise</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-budget">Monthly AI Budget Cap (USD)</Label>
              <Input
                id="cmp-budget"
                type="number"
                min={0}
                step={10}
                value={monthlyBudgetUsd}
                onChange={(e) => setMonthlyBudgetUsd(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cmp-mission">Company Mission & Operating Charter</Label>
            <Textarea
              id="cmp-mission"
              rows={3}
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="What does this company sell, who does it serve, and what should Eva CEO prioritize?"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5">
            <div className="pr-3">
              <div className="text-xs font-medium text-foreground">
                Founder Approves Hires &amp; Spend
              </div>
              <div className="text-[11px] text-muted-foreground">
                Eva runs departments autonomously but queues AI hiring proposals and spend requests for your approval.
              </div>
            </div>
            <Switch
              checked={founderApprovalRequired}
              onCheckedChange={setFounderApprovalRequired}
              aria-label="Require Founder approval for hires and spend"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create Company
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AttachProductDialog({
  open,
  onOpenChange,
  companyName,
  busy,
  onAttach,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  companyName: string
  busy: boolean
  onAttach: (payload: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [kind, setKind] = useState<ProductKind>('product')
  const [stage, setStage] = useState<ProductStage>('building')
  const [targetAudience, setTargetAudience] = useState('')
  const [brief, setBrief] = useState('')
  const [goalsText, setGoalsText] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [documentLabel, setDocumentLabel] = useState('')
  const [documentContent, setDocumentContent] = useState('')
  const [repoOrFolder, setRepoOrFolder] = useState('')
  const [autoPlanByEva, setAutoPlanByEva] = useState(true)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setDocumentLabel(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDocumentContent(reader.result.slice(0, 20_000))
      }
    }
    reader.readAsText(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const ok = await onAttach({
      action: 'attach_product',
      name: name.trim(),
      tagline: tagline.trim(),
      kind,
      stage,
      targetAudience: targetAudience.trim(),
      brief: brief.trim(),
      goals: goalsText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
      websiteUrl: websiteUrl.trim(),
      documentLabel: documentLabel.trim(),
      documentContent: documentContent.trim(),
      repoOrFolder: repoOrFolder.trim(),
      autoPlanByEva,
    })
    if (ok) {
      setName('')
      setTagline('')
      setTargetAudience('')
      setBrief('')
      setGoalsText('')
      setWebsiteUrl('')
      setDocumentLabel('')
      setDocumentContent('')
      setRepoOrFolder('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Attach Product or Project to {companyName}
          </DialogTitle>
          <DialogDescription>
            Combine any of the 4 context sources — business brief, live website URL, pasted/uploaded docs, and optional repo/folder — so Eva CEO and all departments can operate on it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prd-name">Product / Project Name</Label>
              <Input
                id="prd-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Pulse CRM, FitBox Subscription"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prd-tagline">One-line Value Proposition</Label>
              <Input
                id="prd-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="What problem does it solve?"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="prd-kind">Type</Label>
              <select
                id="prd-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ProductKind)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="product">Product</option>
                <option value="service">Service / Agency</option>
                <option value="project">Internal Project</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prd-stage">Stage</Label>
              <select
                id="prd-stage"
                value={stage}
                onChange={(e) => setStage(e.target.value as ProductStage)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="idea">Idea</option>
                <option value="building">Building</option>
                <option value="launched">Launched</option>
                <option value="scaling">Scaling</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prd-audience">Target Customer</Label>
              <Input
                id="prd-audience"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="e.g., SMB founders, clinics"
              />
            </div>
          </div>

          {/* Source 1: Brief & Goals */}
          <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              1. Business Brief &amp; Goals
            </div>
            <Textarea
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe the offering, pricing model, differentiators, and current traction..."
            />
            <Textarea
              rows={2}
              value={goalsText}
              onChange={(e) => setGoalsText(e.target.value)}
              placeholder="Quarterly goals (one per line, e.g. 'Reach 50 paying customers', 'Launch self-serve onboarding')"
            />
          </div>

          {/* Source 2: Website URL */}
          <div className="space-y-1.5 rounded-lg border border-border/80 bg-muted/20 p-3">
            <Label htmlFor="prd-website" className="flex items-center gap-1.5 text-xs font-semibold">
              <Globe className="h-3.5 w-3.5 text-primary" />
              2. Website URL (Optional — Live Context Snapshot)
            </Label>
            <Input
              id="prd-website"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourproduct.com"
            />
          </div>

          {/* Source 3: Docs / Specs */}
          <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="prd-doc" className="flex items-center gap-1.5 text-xs font-semibold">
                <FileText className="h-3.5 w-3.5 text-primary" />
                3. Documents / Specs / Pricing Sheet (Optional)
              </Label>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted">
                <Upload className="h-3 w-3" />
                Load .md / .txt
                <input
                  type="file"
                  accept=".md,.txt,.json,.csv"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>
            </div>
            <Input
              value={documentLabel}
              onChange={(e) => setDocumentLabel(e.target.value)}
              placeholder="Document label (e.g., Pricing & FAQ v2)"
            />
            <Textarea
              id="prd-doc"
              rows={3}
              value={documentContent}
              onChange={(e) => setDocumentContent(e.target.value)}
              placeholder="Paste pitch notes, SOPs, FAQ, PRD, or customer feedback..."
            />
          </div>

          {/* Source 4: Local Folder or GitHub Repo */}
          <div className="space-y-1.5 rounded-lg border border-border/80 bg-muted/20 p-3">
            <Label htmlFor="prd-repo" className="flex items-center gap-1.5 text-xs font-semibold">
              <FolderGit2 className="h-3.5 w-3.5 text-primary" />
              4. Folder Path or GitHub Repository (Optional)
            </Label>
            <Input
              id="prd-repo"
              value={repoOrFolder}
              onChange={(e) => setRepoOrFolder(e.target.value)}
              placeholder="https://github.com/org/repo OR relative workspace folder (e.g. docs)"
            />
          </div>

          {/* Auto-kickoff by Eva CEO */}
          <div className="flex items-center justify-between rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
            <div className="pr-3">
              <div className="text-xs font-medium text-foreground">
                Have Eva CEO plan departments &amp; propose hires immediately
              </div>
              <div className="text-[11px] text-muted-foreground">
                Creates starter workstreams across Sales, Marketing, Product, Support &amp; Finance and queues AI hire proposals for your approval.
              </div>
            </div>
            <Switch
              checked={autoPlanByEva}
              onCheckedChange={setAutoPlanByEva}
              aria-label="Have Eva CEO plan and propose hires"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Attach Product
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
