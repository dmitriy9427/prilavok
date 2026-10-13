import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react'

import { ApiError } from '@/api/http'
import { useDeleteProduct } from '@/api/mutations'
import { productQuery } from '@/api/queries'
import { Page, PageHeader } from '@/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ProductForm } from '@/features/products/product-form'
import { useCan } from '@/lib/auth'
import { formatDate, formatNumber } from '@/lib/format'
import { useChannel } from '@/realtime/hooks'
import { CHANNELS } from '@/shared/protocol'

export const Route = createFileRoute('/_app/products/$productId')({
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(productQuery(params.productId))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound()
      throw error
    }
  },
  component: ProductPage,
  notFoundComponent: () => (
    <Page className="items-center py-20 text-center">
      <p className="text-lg font-medium">Товар не найден</p>
      <Button asChild variant="outline">
        <Link to="/products">К списку товаров</Link>
      </Button>
    </Page>
  ),
})

function ProductPage() {
  const { productId } = Route.useParams()
  const { data: product } = useSuspenseQuery(productQuery(productId))
  const canEdit = useCan('products.update')
  const canDelete = useCan('products.delete')
  const remove = useDeleteProduct()
  const navigate = useNavigate()
  useChannel(CHANNELS.products)

  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground">
        <Link to="/products">
          <ArrowLeftIcon /> Товары
        </Link>
      </Button>
      <PageHeader title={product.title} description={`${product.sku} · продано ${formatNumber(product.sold)} шт. · добавлен ${formatDate(product.createdAt)}`}>
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <Trash2Icon /> Удалить
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить «{product.title}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Товар пропадёт из каталога. В уже оформленных заказах он останется. Действие необратимо — если товар просто закончился, лучше перевести его в архив.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => remove.mutate(product, { onSuccess: () => void navigate({ to: '/products', replace: true }) })}>
                  Удалить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </PageHeader>
      {/* key: перешли к другому товару — форма создаётся заново, а не показывает значения прежнего. */}
      <ProductForm key={product.id} product={product} canEdit={canEdit} onSaved={() => {}} />
    </Page>
  )
}
