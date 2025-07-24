CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();


create policy "test 1m0cqf_0"
on "storage"."objects"
as permissive
for select
to authenticated, service_role
using ((bucket_id = 'files'::text));


create policy "test 1m0cqf_1"
on "storage"."objects"
as permissive
for insert
to authenticated, service_role
with check ((bucket_id = 'files'::text));



