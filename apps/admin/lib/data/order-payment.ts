// ONE definition of "the order's payment" — `latestPaymentFirst()`. It moved to `@tokophi/db/order-payment`
// (BUYER-ACCOUNT-P1) so the TokoΦ Account (apps/account) orders a buyer's payments exactly the way every
// Seller screen does; read the full reasoning there. Every admin import keeps this path.
export { latestPaymentFirst } from "@tokophi/db/order-payment";
