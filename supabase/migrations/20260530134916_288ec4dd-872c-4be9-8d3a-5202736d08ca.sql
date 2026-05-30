
DROP TRIGGER IF EXISTS trg_sales_deduct_raw_material ON public.sales;
DROP TRIGGER IF EXISTS trg_sales_adjust_raw_material ON public.sales;
DROP TRIGGER IF EXISTS trg_sales_reverse_raw_material ON public.sales;

CREATE TRIGGER trg_sales_deduct_raw_material
AFTER INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.deduct_raw_material_on_sale();

CREATE TRIGGER trg_sales_adjust_raw_material
AFTER UPDATE ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.adjust_raw_material_on_sale_update();

CREATE TRIGGER trg_sales_reverse_raw_material
AFTER DELETE ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.reverse_raw_material_on_sale_delete();
