"""The bundled Online Shop 2024 sample dataset: its CSVs (repo-root `sample-data/`, mounted at /sample-data in compose),
the Dataset Notes it ships with, and its As-of Date (the last order date)."""

from pathlib import Path

SAMPLE_DIR = Path(__file__).resolve().parents[2] / "sample-data"
SAMPLE_AS_OF = "2024-11-04"
SAMPLE_NOTES = """\
Revenue = the sum of orders.total_price over orders that have a payment with transaction_status = 'Completed' AND a shipment whose shipment_status is not 'Cancelled'. Join orders to payment and to shipments on order_id (each order has exactly one of each).
Do NOT use payment.amount for revenue or any money figure: it disagrees with orders.total_price on all but one order (known data-quality issue).
order_items (quantity * price_at_purchase) is the source of truth for line-level breakdowns by product, category or supplier; its line totals add up to orders.total_price. Apply the same Revenue filter to the orders when breaking revenue down.
Orders span 2023-11-05 to 2024-11-04."""
