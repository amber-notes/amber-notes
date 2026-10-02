-- "Send it again" on the connect page (/connect/resend): how many times this ask's push was sent
-- again. At most three for a request, whatever address asks, and each one counts toward the
-- account's ten asks in ten minutes.
alter table public.connect_asks add column resends smallint not null default 0 check (resends between 0 and 3);
