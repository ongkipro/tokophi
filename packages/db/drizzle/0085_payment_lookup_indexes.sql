-- The payment webhook matches on `trx_id` OR `reff_id` and neither was indexed — the table has only
-- its primary key. Every gateway callback, and every AutoLaris retry of one, was two sequential scans
-- of a table that grows with every order the platform ever takes.
--
-- Partial (`where … is not null`) because both columns are sparse: a COD payment has neither, and an
-- index over mostly-NULL rows is mostly wasted pages.
create index if not exists payments_trx_idx  on payments (trx_id)  where trx_id  is not null;
create index if not exists payments_reff_idx on payments (reff_id) where reff_id is not null;

-- `order_id` is how the order screen, the ledger credit and the new duplicate-bill guard find a
-- payment. Also unindexed.
create index if not exists payments_order_idx on payments (order_id);
