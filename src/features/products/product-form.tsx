/**
 * Форма товара (react-hook-form + zod).
 *
 * ─── Почему react-hook-form ─────────────────────────────────────────────────
 * Форма на useState перерисовывается целиком на каждую букву. RHF хранит
 * значения вне React и подписывает на изменения только то, что их показывает:
 * печатаешь в «Названии» — остальные 15 полей не перерисовываются.
 *
 * ─── Три уровня проверки ────────────────────────────────────────────────────
 *   1. zod-схема в браузере — мгновенно, под полем (та же схема, что на сервере);
 *   2. сервер проверяет той же схемой — на случай запроса в обход формы;
 *   3. сервер знает то, чего не знает браузер («артикул занят») — такая ошибка
 *      возвращается с именем поля, и форма показывает её там же (setError).
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useBlocker } from '@tanstack/react-router'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'

import { ApiError } from '@/api/http'
import { useSaveProduct } from '@/api/mutations'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORY_LABELS, PRODUCT_STATUS_LABELS, formatNumber } from '@/lib/format'
import { productInput } from '@/shared/schemas'
import { CATEGORIES, PRODUCT_STATUSES, type Product, type ProductInput } from '@/shared/types'

const EMPTY: ProductInput = { title: '', sku: '', category: 'coffee', price: 0, oldPrice: null, stock: 0, status: 'draft', description: '', variants: [] }

/** Поле формы: подпись, сам элемент, подсказка и ошибка — связанные для скринридера. */
function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

/** Атрибуты поля с ошибкой: красная рамка и связь с текстом ошибки. */
const invalid = (id: string, error?: string) => (error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {})

export function ProductForm({ product, onSaved, canEdit }: { product?: Product; onSaved: (product: Product) => void; canEdit: boolean }) {
  const save = useSaveProduct(product?.id ?? null)

  const form = useForm<ProductInput>({
    resolver: zodResolver(productInput),
    // Значения берём из товара один раз. Если данные обновятся из сокета (остаток), набранное не затрётся.
    defaultValues: product
      ? {
          title: product.title,
          sku: product.sku,
          category: product.category,
          price: product.price,
          oldPrice: product.oldPrice,
          stock: product.stock,
          status: product.status,
          description: product.description,
          variants: product.variants,
        }
      : EMPTY,
    // Проверка — при уходе с поля, а после первой ошибки — на каждое изменение (ошибка исчезает, как только исправили).
    mode: 'onBlur',
    reValidateMode: 'onChange',
    disabled: !canEdit,
  })
  const { register, control, handleSubmit, setError, watch, setValue, reset, formState } = form
  const { errors, isDirty } = formState
  const variants = useFieldArray({ control, name: 'variants' })

  const hasVariants = variants.fields.length > 0
  const oldPrice = watch('oldPrice')
  const variantStock = watch('variants').reduce((sum, v) => sum + (Number(v.stock) || 0), 0)

  // Несохранённые изменения: спросить перед уходом со страницы (и перед закрытием вкладки).
  // justSaved — в ref, а не в состоянии: переход на страницу товара происходит сразу после
  // сохранения, в том же тике, когда React ещё не перерисовал форму и isDirty «старое».
  const justSaved = useRef(false)
  useEffect(() => {
    if (isDirty) justSaved.current = false
  }, [isDirty])
  useBlocker({
    shouldBlockFn: () => isDirty && !justSaved.current && !window.confirm('Изменения не сохранены. Уйти со страницы?'),
    enableBeforeUnload: () => isDirty && !justSaved.current,
  })

  const submit = handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: (saved) => {
        // Сохранённые значения становятся «исходными»: форма больше не считается изменённой,
        // и уход со страницы (onSaved ведёт на страницу товара) не вызовет вопрос.
        justSaved.current = true
        reset(values)
        onSaved(saved)
      },
      onError: (error) => {
        if (!(error instanceof ApiError)) return
        // Ошибки сервера — к тем же полям, что и ошибки схемы.
        for (const [field, message] of Object.entries(error.fields)) setError(field as keyof ProductInput, { message })
      },
    }),
  )

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Основное</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="title" label="Название" error={errors.title?.message}>
                <Input id="title" autoComplete="off" {...register('title')} {...invalid('title', errors.title?.message)} />
              </Field>
            </div>
            <Field id="sku" label="Артикул" error={errors.sku?.message} hint="Например: CO-1042">
              <Input
                id="sku"
                autoComplete="off"
                className="uppercase"
                {...register('sku', { setValueAs: (value: string) => value.toUpperCase() })}
                {...invalid('sku', errors.sku?.message)}
              />
            </Field>
            <Field id="category" label="Категория" error={errors.category?.message}>
              {/* Select из Radix — не настоящий <select>: register к нему не подключить, нужен Controller. */}
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}>
                    <SelectTrigger id="category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="description" label="Описание" error={errors.description?.message}>
                <Textarea id="description" rows={4} {...register('description')} {...invalid('description', errors.description?.message)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Варианты</CardTitle>
            <CardDescription>Фасовка, цвет, материал. У товара с вариантами остаток считается по ним.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {variants.fields.map((field, i) => (
              // key — field.id от RHF, а не индекс: при удалении строки значения не «съезжают» в соседние.
              <div key={field.id} className="grid grid-cols-[1fr_7rem_6rem_auto] items-start gap-2">
                <Field id={`variant-${i}-name`} label={i === 0 ? 'Название' : ''} error={errors.variants?.[i]?.name?.message}>
                  <Input
                    id={`variant-${i}-name`}
                    aria-label={`Название варианта ${i + 1}`}
                    placeholder="250 г"
                    {...register(`variants.${i}.name`)}
                    {...invalid(`variant-${i}-name`, errors.variants?.[i]?.name?.message)}
                  />
                </Field>
                <Field id={`variant-${i}-delta`} label={i === 0 ? 'Надбавка, ₽' : ''} error={errors.variants?.[i]?.priceDelta?.message}>
                  <Input
                    id={`variant-${i}-delta`}
                    aria-label={`Надбавка варианта ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    {...register(`variants.${i}.priceDelta`, { valueAsNumber: true })}
                  />
                </Field>
                <Field id={`variant-${i}-stock`} label={i === 0 ? 'Остаток' : ''} error={errors.variants?.[i]?.stock?.message}>
                  <Input
                    id={`variant-${i}-stock`}
                    aria-label={`Остаток варианта ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    {...register(`variants.${i}.stock`, { valueAsNumber: true })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={i === 0 ? 'mt-5.5' : ''}
                  aria-label={`Удалить вариант ${i + 1}`}
                  disabled={!canEdit}
                  onClick={() => variants.remove(i)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {/* Ошибка всего списка («названия повторяются») приходит в root. */}
            {(errors.variants?.root?.message ?? errors.variants?.message) && (
              <p role="alert" className="text-xs text-destructive">
                {errors.variants?.root?.message ?? errors.variants?.message}
              </p>
            )}
            {canEdit && variants.fields.length < 8 && (
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => variants.append({ name: '', priceDelta: 0, stock: 0 })}>
                <PlusIcon /> Добавить вариант
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Цена и склад</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field id="price" label="Цена, ₽" error={errors.price?.message}>
              <Input id="price" type="number" inputMode="numeric" min={0} {...register('price', { valueAsNumber: true })} {...invalid('price', errors.price?.message)} />
            </Field>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sale">Скидка</Label>
              <Switch
                id="sale"
                checked={oldPrice !== null}
                disabled={!canEdit}
                // Скидка выключена — старой цены нет вовсе (null), а не «0».
                onCheckedChange={(on) => setValue('oldPrice', on ? Math.round((watch('price') || 0) * 1.2) : null, { shouldDirty: true, shouldValidate: true })}
              />
            </div>
            {oldPrice !== null && (
              <Field id="oldPrice" label="Старая цена, ₽" error={errors.oldPrice?.message} hint="Показывается зачёркнутой">
                <Input
                  id="oldPrice"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  {...register('oldPrice', { valueAsNumber: true })}
                  {...invalid('oldPrice', errors.oldPrice?.message)}
                />
              </Field>
            )}

            {hasVariants ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Остаток</span>
                <p className="tabular text-sm text-muted-foreground">{formatNumber(variantStock)} шт. — сумма по вариантам</p>
              </div>
            ) : (
              <Field id="stock" label="Остаток, шт." error={errors.stock?.message}>
                <Input id="stock" type="number" inputMode="numeric" min={0} {...register('stock', { valueAsNumber: true })} {...invalid('stock', errors.stock?.message)} />
              </Field>
            )}

            <Field id="status" label="Статус" error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}>
                    <SelectTrigger id="status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {PRODUCT_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </CardContent>
        </Card>

        {canEdit ? (
          <Button type="submit" size="lg" disabled={save.isPending || (!!product && !isDirty)}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            {product ? 'Сохранить' : 'Создать товар'}
          </Button>
        ) : (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">У вашей роли только просмотр: изменить товар нельзя.</p>
        )}
      </div>
    </form>
  )
}
