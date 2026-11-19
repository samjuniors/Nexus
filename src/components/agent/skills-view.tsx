'use client'

import { useState } from 'react'
import { Loader2, Plus, Sparkles, Store, Trash2, Undo2, Zap } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, type EmptyStateGuideStep } from '@/components/agent/empty-state'
import { useApp } from '@/lib/agent/store'
import { pluginIcon } from '@/components/agent/icons'
import { api } from '@/lib/agent/client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const SKILL_GUIDE: EmptyStateGuideStep[] = [
  {
    title: 'Define expertise',
    detail: 'Write reusable engineering rules, checklists, or domain instructions in a skill prompt.',
  },
  {
    title: 'Restore or import',
    detail: 'Re-enable built-in defaults in one click or import SKILL.md packs from GitHub.',
  },
  {
    title: 'Auto-matched execution',
    detail: 'Armed skills load automatically whenever a chat, mission, or voice request matches.',
  },
]

export function SkillsView() {
  const { skills, refreshSkills, setTab } = useApp()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', prompt: '' })
  const [createBusy, setCreateBusy] = useState(false)

  const toggle = async (id: string, name: string, enabled: boolean) => {
    setBusyId(id)
    try {
      await api.patchSkill(id, enabled)
      await refreshSkills()
      toast({ title: enabled ? `Skill armed: ${name}` : `Skill disarmed: ${name}` })
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!confirm) return
    setBusyId(confirm.id)
    const name = confirm.name
    setConfirm(null)
    try {
      await api.deleteSkill(confirm.id)
      await refreshSkills()
      toast({ title: `Skill removed: ${name}`, description: 'Restore defaults any time, or reinstall from the Marketplace.' })
    } catch (e) {
      toast({ title: 'Remove failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const restoreDefaults = async () => {
    setRestoreBusy(true)
    try {
      const { restored } = await api.restoreDefaultSkills()
      await refreshSkills()
      toast({
        title: restored > 0 ? `${restored} default skill${restored > 1 ? 's' : ''} restored` : 'All defaults already installed',
      })
    } catch (e) {
      toast({ title: 'Restore failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setRestoreBusy(false)
    }
  }

  const createSkill = async () => {
    setCreateBusy(true)
    try {
      const { skill } = await api.createSkill({
        name: form.name,
        description: form.description,
        prompt: form.prompt,
      })
      await refreshSkills()
      toast({ title: `Skill created: ${skill.name}` })
      setCreateOpen(false)
      setForm({ name: '', description: '', prompt: '' })
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className="grid-bg h-full overflow-y-auto nice-scroll">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 space-y-6">
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Skills</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {skills.filter((s) => s.enabled).length}/{skills.length} armed
            </Badge>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-white/10 bg-transparent px-2.5 text-[11.5px]"
                disabled={restoreBusy}
                onClick={() => void restoreDefaults()}
              >
                {restoreBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Restore defaults
              </Button>
              <Button size="sm" className="h-8 gap-1.5 px-2.5 text-[11.5px]" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New skill
              </Button>
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Knowledge packs. When a task matches a skill, the agent automatically loads it — just like a human
            expert pulling out the right playbook. Uninstalled defaults can be restored or reinstalled from the
            Marketplace.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((s) => {
            const Icon = pluginIcon(s.icon)
            return (
              <div
                key={s.id}
                className={cn(
                  'rounded-xl border p-4 transition-colors',
                  s.enabled ? 'border-white/10 bg-card' : 'border-white/6 bg-black/20 opacity-60'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04]">
                    <Icon className="h-4.5 w-4.5 text-zinc-300" />
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Switch
                      checked={s.enabled}
                      disabled={busyId === s.id}
                      onCheckedChange={(v) => void toggle(s.id, s.name, v)}
                      aria-label={`Toggle ${s.name}`}
                    />
                    <button
                      className="text-muted-foreground transition-colors hover:text-red-300 disabled:opacity-40"
                      disabled={busyId === s.id}
                      onClick={() => setConfirm({ id: s.id, name: s.name })}
                      aria-label={`Uninstall ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <h3 className="mt-3 text-sm font-medium">{s.name}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{s.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/15 bg-white/5 text-muted-foreground">
                    {s.category}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                    <Zap className="h-3 w-3 text-zinc-400" /> loaded {s.usageCount}×
                  </span>
                </div>
              </div>
            )
          })}
          {skills.length === 0 && (
            <EmptyState
              className="col-span-full"
              icon={Sparkles}
              eyebrow="// knowledge packs"
              title="No skills armed yet"
              description="Skills inject reusable playbooks and engineering standards into the agent's context whenever a matching task runs."
              steps={SKILL_GUIDE}
              actions={
                <>
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Get Started — Create Skill
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 border-white/10 bg-transparent text-xs"
                    disabled={restoreBusy}
                    onClick={() => void restoreDefaults()}
                  >
                    {restoreBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    Restore defaults
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 border-white/10 bg-transparent text-xs"
                    onClick={() => setTab('marketplace')}
                  >
                    <Store className="h-3.5 w-3.5" />
                    Browse Marketplace
                  </Button>
                </>
              }
            />
          )}
        </div>
      </div>

      {/* uninstall confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="border-white/10 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove skill {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent will no longer load this knowledge pack. Default skills can be restored with one click;
              custom skills will need to be reinstalled from the Marketplace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction className="gap-1.5 bg-red-500/90 text-white hover:bg-red-500" onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* create skill dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-white/10 bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a custom skill</DialogTitle>
            <DialogDescription>
              The prompt is injected into the agent&apos;s context whenever this skill is armed and relevant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="skill-name" className="text-[12px]">Name</Label>
              <Input
                id="skill-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. SEO Optimizer"
                className="border-white/10 bg-black/40 text-[13px] focus-visible:ring-primary/40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-desc" className="text-[12px]">Description</Label>
              <Input
                id="skill-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What this skill helps with"
                className="border-white/10 bg-black/40 text-[13px] focus-visible:ring-primary/40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-prompt" className="text-[12px]">Prompt</Label>
              <Textarea
                id="skill-prompt"
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                placeholder="Expertise the agent should apply when this skill is loaded…"
                rows={5}
                className="resize-y border-white/10 bg-black/40 font-mono text-[11.5px] focus-visible:ring-primary/40"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              disabled={createBusy || !form.name.trim() || !form.prompt.trim()}
              onClick={() => void createSkill()}
            >
              {createBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
