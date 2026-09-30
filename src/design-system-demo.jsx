import React from 'react';
import { AlertCircle, Check, LoaderCircle, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export default function DesignSystemDemo() {
  const [category, setCategory] = React.useState('concafe');
  const [enabled, setEnabled] = React.useState(true);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Karma · UI compartida</p>
        <h1 className="font-serif text-3xl italic text-foreground">Componentes de servicio</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Muestra manual de variantes y estados para validar teclado, contraste y uso táctil antes de ampliar la migración.
        </p>
      </header>

      <Card className="gap-4 p-4 sm:p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Botones</CardTitle>
          <CardDescription>Altura de al menos 44 px, foco visible, y los estados conservan su etiqueta.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 px-0">
          <Button><Plus aria-hidden="true" />Nueva venta</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Acción discreta</Button>
          <Button variant="destructive">Cancelar con aviso</Button>
          <Button disabled>Deshabilitado</Button>
          <Button aria-busy="true" disabled><LoaderCircle className="animate-spin" aria-hidden="true" />Guardando…</Button>
        </CardContent>
      </Card>

      <Card className="gap-4 p-4 sm:p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Campos</CardTitle>
          <CardDescription>Las etiquetas permanecen visibles; los errores se asocian al control.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-0 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label htmlFor="demo-search">Buscar producto</Label>
            <Input id="demo-search" placeholder="Ej. café de olla" />
          </div>
          <div className="grid content-start gap-2">
            <Label htmlFor="demo-invalid">Monto (MXN)</Label>
            <Input id="demo-invalid" inputMode="decimal" aria-invalid="true" aria-describedby="demo-invalid-error" placeholder="0.00" />
            <p id="demo-invalid-error" role="alert" className="text-sm text-foreground">Captura un monto válido.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4 p-4 sm:p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Estados</CardTitle>
          <CardDescription>El texto y el icono comunican el estado además del color.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 px-0">
          <Badge variant="outline"><AlertCircle aria-hidden="true" />Borrador</Badge>
          <Badge variant="pending"><LoaderCircle aria-hidden="true" />Por sincronizar</Badge>
          <Badge variant="success"><Check aria-hidden="true" />Sincronizada</Badge>
          <Badge variant="conflict"><AlertCircle aria-hidden="true" />Conflicto</Badge>
        </CardContent>
      </Card>

      <Card className="gap-4 p-4 sm:p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Selección y preferencias</CardTitle>
          <CardDescription>Controles con estado visible, etiquetas asociadas y soporte de teclado.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-0 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label htmlFor="demo-category">Categoría del producto</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="demo-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="concafe">Con café</SelectItem>
                <SelectItem value="lattes">Lattes</SelectItem>
                <SelectItem value="postres">Postres</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-h-11 items-center gap-3">
            <Label htmlFor="demo-availability">Disponible en el POS</Label>
            <Switch id="demo-availability" checked={enabled} onCheckedChange={setEnabled} aria-label="Disponible en el POS" />
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4 p-4 sm:p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Diálogo accesible</CardTitle>
          <CardDescription>Abre con teclado, recorre los controles, cierra con Escape y verifica el retorno de foco al botón.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Probar diálogo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancelar la cuenta</DialogTitle>
                <DialogDescription>La cuenta permanecerá guardada en el historial. Indica el motivo antes de confirmar.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="demo-reason">Motivo (obligatorio)</Label>
                <Textarea id="demo-reason" placeholder="Describe el motivo…" />
              </div>
              <DialogFooter>
                <Button variant="outline">Volver</Button>
                <Button variant="destructive">Confirmar cancelación</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </main>
  );
}
