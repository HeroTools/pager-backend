drop extension if exists "pg_net";

create sequence "public"."migration_jobs_id_seq";

revoke delete on table "public"."agents" from "anon";

revoke insert on table "public"."agents" from "anon";

revoke references on table "public"."agents" from "anon";

revoke select on table "public"."agents" from "anon";

revoke trigger on table "public"."agents" from "anon";

revoke truncate on table "public"."agents" from "anon";

revoke update on table "public"."agents" from "anon";

revoke delete on table "public"."agents" from "authenticated";

revoke insert on table "public"."agents" from "authenticated";

revoke references on table "public"."agents" from "authenticated";

revoke select on table "public"."agents" from "authenticated";

revoke trigger on table "public"."agents" from "authenticated";

revoke truncate on table "public"."agents" from "authenticated";

revoke update on table "public"."agents" from "authenticated";

revoke delete on table "public"."agents" from "service_role";

revoke insert on table "public"."agents" from "service_role";

revoke references on table "public"."agents" from "service_role";

revoke select on table "public"."agents" from "service_role";

revoke trigger on table "public"."agents" from "service_role";

revoke truncate on table "public"."agents" from "service_role";

revoke update on table "public"."agents" from "service_role";

revoke delete on table "public"."ai_conversation_memory" from "anon";

revoke insert on table "public"."ai_conversation_memory" from "anon";

revoke references on table "public"."ai_conversation_memory" from "anon";

revoke select on table "public"."ai_conversation_memory" from "anon";

revoke trigger on table "public"."ai_conversation_memory" from "anon";

revoke truncate on table "public"."ai_conversation_memory" from "anon";

revoke update on table "public"."ai_conversation_memory" from "anon";

revoke delete on table "public"."ai_conversation_memory" from "authenticated";

revoke insert on table "public"."ai_conversation_memory" from "authenticated";

revoke references on table "public"."ai_conversation_memory" from "authenticated";

revoke select on table "public"."ai_conversation_memory" from "authenticated";

revoke trigger on table "public"."ai_conversation_memory" from "authenticated";

revoke truncate on table "public"."ai_conversation_memory" from "authenticated";

revoke update on table "public"."ai_conversation_memory" from "authenticated";

revoke delete on table "public"."ai_conversation_memory" from "service_role";

revoke insert on table "public"."ai_conversation_memory" from "service_role";

revoke references on table "public"."ai_conversation_memory" from "service_role";

revoke select on table "public"."ai_conversation_memory" from "service_role";

revoke trigger on table "public"."ai_conversation_memory" from "service_role";

revoke truncate on table "public"."ai_conversation_memory" from "service_role";

revoke update on table "public"."ai_conversation_memory" from "service_role";

revoke delete on table "public"."audit_logs" from "anon";

revoke insert on table "public"."audit_logs" from "anon";

revoke references on table "public"."audit_logs" from "anon";

revoke select on table "public"."audit_logs" from "anon";

revoke trigger on table "public"."audit_logs" from "anon";

revoke truncate on table "public"."audit_logs" from "anon";

revoke update on table "public"."audit_logs" from "anon";

revoke delete on table "public"."audit_logs" from "authenticated";

revoke insert on table "public"."audit_logs" from "authenticated";

revoke references on table "public"."audit_logs" from "authenticated";

revoke select on table "public"."audit_logs" from "authenticated";

revoke trigger on table "public"."audit_logs" from "authenticated";

revoke truncate on table "public"."audit_logs" from "authenticated";

revoke update on table "public"."audit_logs" from "authenticated";

revoke delete on table "public"."audit_logs" from "service_role";

revoke insert on table "public"."audit_logs" from "service_role";

revoke references on table "public"."audit_logs" from "service_role";

revoke select on table "public"."audit_logs" from "service_role";

revoke trigger on table "public"."audit_logs" from "service_role";

revoke truncate on table "public"."audit_logs" from "service_role";

revoke update on table "public"."audit_logs" from "service_role";

revoke delete on table "public"."call_participants" from "anon";

revoke insert on table "public"."call_participants" from "anon";

revoke references on table "public"."call_participants" from "anon";

revoke select on table "public"."call_participants" from "anon";

revoke trigger on table "public"."call_participants" from "anon";

revoke truncate on table "public"."call_participants" from "anon";

revoke update on table "public"."call_participants" from "anon";

revoke delete on table "public"."call_participants" from "authenticated";

revoke insert on table "public"."call_participants" from "authenticated";

revoke references on table "public"."call_participants" from "authenticated";

revoke select on table "public"."call_participants" from "authenticated";

revoke trigger on table "public"."call_participants" from "authenticated";

revoke truncate on table "public"."call_participants" from "authenticated";

revoke update on table "public"."call_participants" from "authenticated";

revoke delete on table "public"."call_participants" from "service_role";

revoke insert on table "public"."call_participants" from "service_role";

revoke references on table "public"."call_participants" from "service_role";

revoke select on table "public"."call_participants" from "service_role";

revoke trigger on table "public"."call_participants" from "service_role";

revoke truncate on table "public"."call_participants" from "service_role";

revoke update on table "public"."call_participants" from "service_role";

revoke delete on table "public"."calls" from "anon";

revoke insert on table "public"."calls" from "anon";

revoke references on table "public"."calls" from "anon";

revoke select on table "public"."calls" from "anon";

revoke trigger on table "public"."calls" from "anon";

revoke truncate on table "public"."calls" from "anon";

revoke update on table "public"."calls" from "anon";

revoke delete on table "public"."calls" from "authenticated";

revoke insert on table "public"."calls" from "authenticated";

revoke references on table "public"."calls" from "authenticated";

revoke select on table "public"."calls" from "authenticated";

revoke trigger on table "public"."calls" from "authenticated";

revoke truncate on table "public"."calls" from "authenticated";

revoke update on table "public"."calls" from "authenticated";

revoke delete on table "public"."calls" from "service_role";

revoke insert on table "public"."calls" from "service_role";

revoke references on table "public"."calls" from "service_role";

revoke select on table "public"."calls" from "service_role";

revoke trigger on table "public"."calls" from "service_role";

revoke truncate on table "public"."calls" from "service_role";

revoke update on table "public"."calls" from "service_role";

revoke delete on table "public"."channel_members" from "anon";

revoke insert on table "public"."channel_members" from "anon";

revoke references on table "public"."channel_members" from "anon";

revoke select on table "public"."channel_members" from "anon";

revoke trigger on table "public"."channel_members" from "anon";

revoke truncate on table "public"."channel_members" from "anon";

revoke update on table "public"."channel_members" from "anon";

revoke delete on table "public"."channel_members" from "authenticated";

revoke insert on table "public"."channel_members" from "authenticated";

revoke references on table "public"."channel_members" from "authenticated";

revoke select on table "public"."channel_members" from "authenticated";

revoke trigger on table "public"."channel_members" from "authenticated";

revoke truncate on table "public"."channel_members" from "authenticated";

revoke update on table "public"."channel_members" from "authenticated";

revoke delete on table "public"."channel_members" from "service_role";

revoke insert on table "public"."channel_members" from "service_role";

revoke references on table "public"."channel_members" from "service_role";

revoke select on table "public"."channel_members" from "service_role";

revoke trigger on table "public"."channel_members" from "service_role";

revoke truncate on table "public"."channel_members" from "service_role";

revoke update on table "public"."channel_members" from "service_role";

revoke delete on table "public"."channels" from "anon";

revoke insert on table "public"."channels" from "anon";

revoke references on table "public"."channels" from "anon";

revoke select on table "public"."channels" from "anon";

revoke trigger on table "public"."channels" from "anon";

revoke truncate on table "public"."channels" from "anon";

revoke update on table "public"."channels" from "anon";

revoke delete on table "public"."channels" from "authenticated";

revoke insert on table "public"."channels" from "authenticated";

revoke references on table "public"."channels" from "authenticated";

revoke select on table "public"."channels" from "authenticated";

revoke trigger on table "public"."channels" from "authenticated";

revoke truncate on table "public"."channels" from "authenticated";

revoke update on table "public"."channels" from "authenticated";

revoke delete on table "public"."channels" from "service_role";

revoke insert on table "public"."channels" from "service_role";

revoke references on table "public"."channels" from "service_role";

revoke select on table "public"."channels" from "service_role";

revoke trigger on table "public"."channels" from "service_role";

revoke truncate on table "public"."channels" from "service_role";

revoke update on table "public"."channels" from "service_role";

revoke delete on table "public"."conversation_members" from "anon";

revoke insert on table "public"."conversation_members" from "anon";

revoke references on table "public"."conversation_members" from "anon";

revoke select on table "public"."conversation_members" from "anon";

revoke trigger on table "public"."conversation_members" from "anon";

revoke truncate on table "public"."conversation_members" from "anon";

revoke update on table "public"."conversation_members" from "anon";

revoke delete on table "public"."conversation_members" from "authenticated";

revoke insert on table "public"."conversation_members" from "authenticated";

revoke references on table "public"."conversation_members" from "authenticated";

revoke select on table "public"."conversation_members" from "authenticated";

revoke trigger on table "public"."conversation_members" from "authenticated";

revoke truncate on table "public"."conversation_members" from "authenticated";

revoke update on table "public"."conversation_members" from "authenticated";

revoke delete on table "public"."conversation_members" from "service_role";

revoke insert on table "public"."conversation_members" from "service_role";

revoke references on table "public"."conversation_members" from "service_role";

revoke select on table "public"."conversation_members" from "service_role";

revoke trigger on table "public"."conversation_members" from "service_role";

revoke truncate on table "public"."conversation_members" from "service_role";

revoke update on table "public"."conversation_members" from "service_role";

revoke delete on table "public"."conversations" from "anon";

revoke insert on table "public"."conversations" from "anon";

revoke references on table "public"."conversations" from "anon";

revoke select on table "public"."conversations" from "anon";

revoke trigger on table "public"."conversations" from "anon";

revoke truncate on table "public"."conversations" from "anon";

revoke update on table "public"."conversations" from "anon";

revoke delete on table "public"."conversations" from "authenticated";

revoke insert on table "public"."conversations" from "authenticated";

revoke references on table "public"."conversations" from "authenticated";

revoke select on table "public"."conversations" from "authenticated";

revoke trigger on table "public"."conversations" from "authenticated";

revoke truncate on table "public"."conversations" from "authenticated";

revoke update on table "public"."conversations" from "authenticated";

revoke delete on table "public"."conversations" from "service_role";

revoke insert on table "public"."conversations" from "service_role";

revoke references on table "public"."conversations" from "service_role";

revoke select on table "public"."conversations" from "service_role";

revoke trigger on table "public"."conversations" from "service_role";

revoke truncate on table "public"."conversations" from "service_role";

revoke update on table "public"."conversations" from "service_role";

revoke delete on table "public"."custom_emojis" from "anon";

revoke insert on table "public"."custom_emojis" from "anon";

revoke references on table "public"."custom_emojis" from "anon";

revoke select on table "public"."custom_emojis" from "anon";

revoke trigger on table "public"."custom_emojis" from "anon";

revoke truncate on table "public"."custom_emojis" from "anon";

revoke update on table "public"."custom_emojis" from "anon";

revoke delete on table "public"."custom_emojis" from "authenticated";

revoke insert on table "public"."custom_emojis" from "authenticated";

revoke references on table "public"."custom_emojis" from "authenticated";

revoke select on table "public"."custom_emojis" from "authenticated";

revoke trigger on table "public"."custom_emojis" from "authenticated";

revoke truncate on table "public"."custom_emojis" from "authenticated";

revoke update on table "public"."custom_emojis" from "authenticated";

revoke delete on table "public"."custom_emojis" from "service_role";

revoke insert on table "public"."custom_emojis" from "service_role";

revoke references on table "public"."custom_emojis" from "service_role";

revoke select on table "public"."custom_emojis" from "service_role";

revoke trigger on table "public"."custom_emojis" from "service_role";

revoke truncate on table "public"."custom_emojis" from "service_role";

revoke update on table "public"."custom_emojis" from "service_role";

revoke delete on table "public"."invites" from "anon";

revoke insert on table "public"."invites" from "anon";

revoke references on table "public"."invites" from "anon";

revoke select on table "public"."invites" from "anon";

revoke trigger on table "public"."invites" from "anon";

revoke truncate on table "public"."invites" from "anon";

revoke update on table "public"."invites" from "anon";

revoke delete on table "public"."invites" from "authenticated";

revoke insert on table "public"."invites" from "authenticated";

revoke references on table "public"."invites" from "authenticated";

revoke select on table "public"."invites" from "authenticated";

revoke trigger on table "public"."invites" from "authenticated";

revoke truncate on table "public"."invites" from "authenticated";

revoke update on table "public"."invites" from "authenticated";

revoke delete on table "public"."invites" from "service_role";

revoke insert on table "public"."invites" from "service_role";

revoke references on table "public"."invites" from "service_role";

revoke select on table "public"."invites" from "service_role";

revoke trigger on table "public"."invites" from "service_role";

revoke truncate on table "public"."invites" from "service_role";

revoke update on table "public"."invites" from "service_role";

revoke delete on table "public"."message_attachments" from "anon";

revoke insert on table "public"."message_attachments" from "anon";

revoke references on table "public"."message_attachments" from "anon";

revoke select on table "public"."message_attachments" from "anon";

revoke trigger on table "public"."message_attachments" from "anon";

revoke truncate on table "public"."message_attachments" from "anon";

revoke update on table "public"."message_attachments" from "anon";

revoke delete on table "public"."message_attachments" from "authenticated";

revoke insert on table "public"."message_attachments" from "authenticated";

revoke references on table "public"."message_attachments" from "authenticated";

revoke select on table "public"."message_attachments" from "authenticated";

revoke trigger on table "public"."message_attachments" from "authenticated";

revoke truncate on table "public"."message_attachments" from "authenticated";

revoke update on table "public"."message_attachments" from "authenticated";

revoke delete on table "public"."message_attachments" from "service_role";

revoke insert on table "public"."message_attachments" from "service_role";

revoke references on table "public"."message_attachments" from "service_role";

revoke select on table "public"."message_attachments" from "service_role";

revoke trigger on table "public"."message_attachments" from "service_role";

revoke truncate on table "public"."message_attachments" from "service_role";

revoke update on table "public"."message_attachments" from "service_role";

revoke delete on table "public"."message_embeddings" from "anon";

revoke insert on table "public"."message_embeddings" from "anon";

revoke references on table "public"."message_embeddings" from "anon";

revoke select on table "public"."message_embeddings" from "anon";

revoke trigger on table "public"."message_embeddings" from "anon";

revoke truncate on table "public"."message_embeddings" from "anon";

revoke update on table "public"."message_embeddings" from "anon";

revoke delete on table "public"."message_embeddings" from "authenticated";

revoke insert on table "public"."message_embeddings" from "authenticated";

revoke references on table "public"."message_embeddings" from "authenticated";

revoke select on table "public"."message_embeddings" from "authenticated";

revoke trigger on table "public"."message_embeddings" from "authenticated";

revoke truncate on table "public"."message_embeddings" from "authenticated";

revoke update on table "public"."message_embeddings" from "authenticated";

revoke delete on table "public"."message_embeddings" from "service_role";

revoke insert on table "public"."message_embeddings" from "service_role";

revoke references on table "public"."message_embeddings" from "service_role";

revoke select on table "public"."message_embeddings" from "service_role";

revoke trigger on table "public"."message_embeddings" from "service_role";

revoke truncate on table "public"."message_embeddings" from "service_role";

revoke update on table "public"."message_embeddings" from "service_role";

revoke delete on table "public"."messages" from "anon";

revoke insert on table "public"."messages" from "anon";

revoke references on table "public"."messages" from "anon";

revoke select on table "public"."messages" from "anon";

revoke trigger on table "public"."messages" from "anon";

revoke truncate on table "public"."messages" from "anon";

revoke update on table "public"."messages" from "anon";

revoke delete on table "public"."messages" from "authenticated";

revoke insert on table "public"."messages" from "authenticated";

revoke references on table "public"."messages" from "authenticated";

revoke select on table "public"."messages" from "authenticated";

revoke trigger on table "public"."messages" from "authenticated";

revoke truncate on table "public"."messages" from "authenticated";

revoke update on table "public"."messages" from "authenticated";

revoke delete on table "public"."messages" from "service_role";

revoke insert on table "public"."messages" from "service_role";

revoke references on table "public"."messages" from "service_role";

revoke select on table "public"."messages" from "service_role";

revoke trigger on table "public"."messages" from "service_role";

revoke truncate on table "public"."messages" from "service_role";

revoke update on table "public"."messages" from "service_role";

revoke delete on table "public"."notifications" from "anon";

revoke insert on table "public"."notifications" from "anon";

revoke references on table "public"."notifications" from "anon";

revoke select on table "public"."notifications" from "anon";

revoke trigger on table "public"."notifications" from "anon";

revoke truncate on table "public"."notifications" from "anon";

revoke update on table "public"."notifications" from "anon";

revoke delete on table "public"."notifications" from "authenticated";

revoke insert on table "public"."notifications" from "authenticated";

revoke references on table "public"."notifications" from "authenticated";

revoke select on table "public"."notifications" from "authenticated";

revoke trigger on table "public"."notifications" from "authenticated";

revoke truncate on table "public"."notifications" from "authenticated";

revoke update on table "public"."notifications" from "authenticated";

revoke delete on table "public"."notifications" from "service_role";

revoke insert on table "public"."notifications" from "service_role";

revoke references on table "public"."notifications" from "service_role";

revoke select on table "public"."notifications" from "service_role";

revoke trigger on table "public"."notifications" from "service_role";

revoke truncate on table "public"."notifications" from "service_role";

revoke update on table "public"."notifications" from "service_role";

revoke delete on table "public"."reactions" from "anon";

revoke insert on table "public"."reactions" from "anon";

revoke references on table "public"."reactions" from "anon";

revoke select on table "public"."reactions" from "anon";

revoke trigger on table "public"."reactions" from "anon";

revoke truncate on table "public"."reactions" from "anon";

revoke update on table "public"."reactions" from "anon";

revoke delete on table "public"."reactions" from "authenticated";

revoke insert on table "public"."reactions" from "authenticated";

revoke references on table "public"."reactions" from "authenticated";

revoke select on table "public"."reactions" from "authenticated";

revoke trigger on table "public"."reactions" from "authenticated";

revoke truncate on table "public"."reactions" from "authenticated";

revoke update on table "public"."reactions" from "authenticated";

revoke delete on table "public"."reactions" from "service_role";

revoke insert on table "public"."reactions" from "service_role";

revoke references on table "public"."reactions" from "service_role";

revoke select on table "public"."reactions" from "service_role";

revoke trigger on table "public"."reactions" from "service_role";

revoke truncate on table "public"."reactions" from "service_role";

revoke update on table "public"."reactions" from "service_role";

revoke delete on table "public"."uploaded_files" from "anon";

revoke insert on table "public"."uploaded_files" from "anon";

revoke references on table "public"."uploaded_files" from "anon";

revoke select on table "public"."uploaded_files" from "anon";

revoke trigger on table "public"."uploaded_files" from "anon";

revoke truncate on table "public"."uploaded_files" from "anon";

revoke update on table "public"."uploaded_files" from "anon";

revoke delete on table "public"."uploaded_files" from "authenticated";

revoke insert on table "public"."uploaded_files" from "authenticated";

revoke references on table "public"."uploaded_files" from "authenticated";

revoke select on table "public"."uploaded_files" from "authenticated";

revoke trigger on table "public"."uploaded_files" from "authenticated";

revoke truncate on table "public"."uploaded_files" from "authenticated";

revoke update on table "public"."uploaded_files" from "authenticated";

revoke delete on table "public"."uploaded_files" from "service_role";

revoke insert on table "public"."uploaded_files" from "service_role";

revoke references on table "public"."uploaded_files" from "service_role";

revoke select on table "public"."uploaded_files" from "service_role";

revoke trigger on table "public"."uploaded_files" from "service_role";

revoke truncate on table "public"."uploaded_files" from "service_role";

revoke update on table "public"."uploaded_files" from "service_role";

revoke delete on table "public"."user_status" from "anon";

revoke insert on table "public"."user_status" from "anon";

revoke references on table "public"."user_status" from "anon";

revoke select on table "public"."user_status" from "anon";

revoke trigger on table "public"."user_status" from "anon";

revoke truncate on table "public"."user_status" from "anon";

revoke update on table "public"."user_status" from "anon";

revoke delete on table "public"."user_status" from "authenticated";

revoke insert on table "public"."user_status" from "authenticated";

revoke references on table "public"."user_status" from "authenticated";

revoke select on table "public"."user_status" from "authenticated";

revoke trigger on table "public"."user_status" from "authenticated";

revoke truncate on table "public"."user_status" from "authenticated";

revoke update on table "public"."user_status" from "authenticated";

revoke delete on table "public"."user_status" from "service_role";

revoke insert on table "public"."user_status" from "service_role";

revoke references on table "public"."user_status" from "service_role";

revoke select on table "public"."user_status" from "service_role";

revoke trigger on table "public"."user_status" from "service_role";

revoke truncate on table "public"."user_status" from "service_role";

revoke update on table "public"."user_status" from "service_role";

revoke delete on table "public"."users" from "anon";

revoke insert on table "public"."users" from "anon";

revoke references on table "public"."users" from "anon";

revoke select on table "public"."users" from "anon";

revoke trigger on table "public"."users" from "anon";

revoke truncate on table "public"."users" from "anon";

revoke update on table "public"."users" from "anon";

revoke delete on table "public"."users" from "authenticated";

revoke insert on table "public"."users" from "authenticated";

revoke references on table "public"."users" from "authenticated";

revoke select on table "public"."users" from "authenticated";

revoke trigger on table "public"."users" from "authenticated";

revoke truncate on table "public"."users" from "authenticated";

revoke update on table "public"."users" from "authenticated";

revoke delete on table "public"."users" from "service_role";

revoke insert on table "public"."users" from "service_role";

revoke references on table "public"."users" from "service_role";

revoke select on table "public"."users" from "service_role";

revoke trigger on table "public"."users" from "service_role";

revoke truncate on table "public"."users" from "service_role";

revoke update on table "public"."users" from "service_role";

revoke delete on table "public"."workspace_embedding_usage" from "anon";

revoke insert on table "public"."workspace_embedding_usage" from "anon";

revoke references on table "public"."workspace_embedding_usage" from "anon";

revoke select on table "public"."workspace_embedding_usage" from "anon";

revoke trigger on table "public"."workspace_embedding_usage" from "anon";

revoke truncate on table "public"."workspace_embedding_usage" from "anon";

revoke update on table "public"."workspace_embedding_usage" from "anon";

revoke delete on table "public"."workspace_embedding_usage" from "authenticated";

revoke insert on table "public"."workspace_embedding_usage" from "authenticated";

revoke references on table "public"."workspace_embedding_usage" from "authenticated";

revoke select on table "public"."workspace_embedding_usage" from "authenticated";

revoke trigger on table "public"."workspace_embedding_usage" from "authenticated";

revoke truncate on table "public"."workspace_embedding_usage" from "authenticated";

revoke update on table "public"."workspace_embedding_usage" from "authenticated";

revoke delete on table "public"."workspace_embedding_usage" from "service_role";

revoke insert on table "public"."workspace_embedding_usage" from "service_role";

revoke references on table "public"."workspace_embedding_usage" from "service_role";

revoke select on table "public"."workspace_embedding_usage" from "service_role";

revoke trigger on table "public"."workspace_embedding_usage" from "service_role";

revoke truncate on table "public"."workspace_embedding_usage" from "service_role";

revoke update on table "public"."workspace_embedding_usage" from "service_role";

revoke delete on table "public"."workspace_invite_tokens" from "anon";

revoke insert on table "public"."workspace_invite_tokens" from "anon";

revoke references on table "public"."workspace_invite_tokens" from "anon";

revoke select on table "public"."workspace_invite_tokens" from "anon";

revoke trigger on table "public"."workspace_invite_tokens" from "anon";

revoke truncate on table "public"."workspace_invite_tokens" from "anon";

revoke update on table "public"."workspace_invite_tokens" from "anon";

revoke delete on table "public"."workspace_invite_tokens" from "authenticated";

revoke insert on table "public"."workspace_invite_tokens" from "authenticated";

revoke references on table "public"."workspace_invite_tokens" from "authenticated";

revoke select on table "public"."workspace_invite_tokens" from "authenticated";

revoke trigger on table "public"."workspace_invite_tokens" from "authenticated";

revoke truncate on table "public"."workspace_invite_tokens" from "authenticated";

revoke update on table "public"."workspace_invite_tokens" from "authenticated";

revoke delete on table "public"."workspace_invite_tokens" from "service_role";

revoke insert on table "public"."workspace_invite_tokens" from "service_role";

revoke references on table "public"."workspace_invite_tokens" from "service_role";

revoke select on table "public"."workspace_invite_tokens" from "service_role";

revoke trigger on table "public"."workspace_invite_tokens" from "service_role";

revoke truncate on table "public"."workspace_invite_tokens" from "service_role";

revoke update on table "public"."workspace_invite_tokens" from "service_role";

revoke delete on table "public"."workspace_members" from "anon";

revoke insert on table "public"."workspace_members" from "anon";

revoke references on table "public"."workspace_members" from "anon";

revoke select on table "public"."workspace_members" from "anon";

revoke trigger on table "public"."workspace_members" from "anon";

revoke truncate on table "public"."workspace_members" from "anon";

revoke update on table "public"."workspace_members" from "anon";

revoke delete on table "public"."workspace_members" from "authenticated";

revoke insert on table "public"."workspace_members" from "authenticated";

revoke references on table "public"."workspace_members" from "authenticated";

revoke select on table "public"."workspace_members" from "authenticated";

revoke trigger on table "public"."workspace_members" from "authenticated";

revoke truncate on table "public"."workspace_members" from "authenticated";

revoke update on table "public"."workspace_members" from "authenticated";

revoke delete on table "public"."workspace_members" from "service_role";

revoke insert on table "public"."workspace_members" from "service_role";

revoke references on table "public"."workspace_members" from "service_role";

revoke select on table "public"."workspace_members" from "service_role";

revoke trigger on table "public"."workspace_members" from "service_role";

revoke truncate on table "public"."workspace_members" from "service_role";

revoke update on table "public"."workspace_members" from "service_role";

revoke delete on table "public"."workspaces" from "anon";

revoke insert on table "public"."workspaces" from "anon";

revoke references on table "public"."workspaces" from "anon";

revoke select on table "public"."workspaces" from "anon";

revoke trigger on table "public"."workspaces" from "anon";

revoke truncate on table "public"."workspaces" from "anon";

revoke update on table "public"."workspaces" from "anon";

revoke delete on table "public"."workspaces" from "authenticated";

revoke insert on table "public"."workspaces" from "authenticated";

revoke references on table "public"."workspaces" from "authenticated";

revoke select on table "public"."workspaces" from "authenticated";

revoke trigger on table "public"."workspaces" from "authenticated";

revoke truncate on table "public"."workspaces" from "authenticated";

revoke update on table "public"."workspaces" from "authenticated";

revoke delete on table "public"."workspaces" from "service_role";

revoke insert on table "public"."workspaces" from "service_role";

revoke references on table "public"."workspaces" from "service_role";

revoke select on table "public"."workspaces" from "service_role";

revoke trigger on table "public"."workspaces" from "service_role";

revoke truncate on table "public"."workspaces" from "service_role";

revoke update on table "public"."workspaces" from "service_role";

alter table "public"."agents" drop constraint "agents_workspace_id_fkey";

alter table "public"."call_participants" drop constraint "call_participants_status_check";

alter table "public"."calls" drop constraint "calls_call_type_check";

alter table "public"."calls" drop constraint "calls_status_check";

alter table "public"."channel_members" drop constraint "channel_members_role_check";

alter table "public"."channels" drop constraint "channels_channel_type_check";

alter table "public"."invites" drop constraint "invites_status_check";

alter table "public"."notifications" drop constraint "notifications_type_check";

alter table "public"."user_status" drop constraint "user_status_status_check";


  create table "public"."agent_mcp_access" (
    "id" uuid not null default gen_random_uuid(),
    "agent_id" uuid not null,
    "mcp_connection_id" uuid not null,
    "is_enabled" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."agent_mcp_access" enable row level security;


  create table "public"."huddle_embeddings" (
    "id" uuid not null default gen_random_uuid(),
    "huddle_id" uuid not null,
    "transcript_id" uuid not null,
    "embedding" vector(1536),
    "embedding_model" character varying not null,
    "token_count" integer,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."huddle_embeddings" enable row level security;


  create table "public"."huddle_participants" (
    "id" uuid not null default gen_random_uuid(),
    "huddle_id" uuid not null,
    "workspace_member_id" uuid not null,
    "role" character varying not null default 'participant'::character varying,
    "joined_at" timestamp with time zone not null default now(),
    "left_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."huddle_participants" enable row level security;


  create table "public"."huddle_transcripts" (
    "id" uuid not null default gen_random_uuid(),
    "huddle_id" uuid not null,
    "speaker_id" uuid,
    "content" text not null,
    "transcript_timestamp" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."huddle_transcripts" enable row level security;


  create table "public"."huddles" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "channel_id" uuid,
    "conversation_id" uuid,
    "initiated_by_workspace_member_id" uuid not null,
    "title" text,
    "status" character varying not null default 'active'::character varying,
    "started_at" timestamp with time zone not null default now(),
    "ended_at" timestamp with time zone,
    "duration_seconds" integer,
    "metadata" jsonb default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."huddles" enable row level security;


  create table "public"."mcp_connections" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "provider" character varying not null,
    "name" character varying not null,
    "description" text,
    "server_url" text not null,
    "server_label" character varying not null,
    "auth_headers" jsonb,
    "require_approval" boolean not null default false,
    "allowed_tools" text[],
    "status" character varying not null default 'active'::character varying,
    "last_tested_at" timestamp with time zone,
    "created_by_user_id" uuid not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "oauth_config" jsonb,
    "auth_state" character varying(255)
      );


alter table "public"."mcp_connections" enable row level security;


  create table "public"."mcp_oauth_states" (
    "id" uuid not null default gen_random_uuid(),
    "connection_id" uuid not null,
    "state" character varying(255) not null,
    "provider" character varying(50) not null,
    "workspace_id" uuid not null,
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null default (now() + '00:10:00'::interval)
      );


alter table "public"."mcp_oauth_states" enable row level security;


  create table "public"."message_mentions" (
    "id" uuid not null default gen_random_uuid(),
    "message_id" uuid not null,
    "mentioned_entity_id" uuid not null,
    "mentioned_entity_type" character varying not null default 'user'::character varying,
    "workspace_id" uuid not null,
    "mentioned_at" timestamp with time zone not null default now()
      );



  create table "public"."migration_jobs" (
    "id" bigint not null default nextval('migration_jobs_id_seq'::regclass),
    "job_id" uuid not null,
    "workspace_id" uuid not null,
    "user_id" uuid not null,
    "status" character varying(20) not null default 'pending'::character varying,
    "progress" jsonb default '{}'::jsonb,
    "error" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "completed_at" timestamp with time zone
      );



  create table "public"."webhook_processing_errors" (
    "id" uuid not null default gen_random_uuid(),
    "webhook_id" uuid not null,
    "request_id" uuid not null,
    "workspace_id" uuid not null,
    "channel_id" uuid not null,
    "error_message" text not null,
    "error_details" jsonb,
    "failed_at" timestamp with time zone not null default now()
      );


alter table "public"."webhook_processing_errors" enable row level security;


  create table "public"."webhook_unauthorized_attempts" (
    "id" uuid not null default gen_random_uuid(),
    "webhook_id" uuid not null,
    "source_ip" inet not null,
    "user_agent" text,
    "failure_reason" text,
    "attempted_at" timestamp with time zone not null default now()
      );


alter table "public"."webhook_unauthorized_attempts" enable row level security;


  create table "public"."webhook_usage" (
    "id" uuid not null default gen_random_uuid(),
    "webhook_id" uuid not null,
    "created_at" timestamp with time zone not null default now(),
    "source_ip" inet,
    "user_agent" text,
    "authenticated_user" text
      );


alter table "public"."webhook_usage" enable row level security;


  create table "public"."webhooks" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "channel_id" uuid,
    "name" character varying not null,
    "secret_token" character varying not null,
    "signing_secret" text,
    "is_active" boolean not null default true,
    "created_by_user_id" uuid not null,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "message_count" integer default 0,
    "last_message_at" timestamp with time zone,
    "source_type" text default 'custom'::text,
    "updated_at" timestamp with time zone
      );


alter table "public"."webhooks" enable row level security;

alter table "public"."messages" add column "webhook_id" uuid;

alter sequence "public"."migration_jobs_id_seq" owned by "public"."migration_jobs"."id";

CREATE UNIQUE INDEX agent_mcp_access_pkey ON public.agent_mcp_access USING btree (id);

CREATE UNIQUE INDEX agent_mcp_access_unique ON public.agent_mcp_access USING btree (agent_id, mcp_connection_id);

CREATE UNIQUE INDEX huddle_embeddings_pkey ON public.huddle_embeddings USING btree (id);

CREATE UNIQUE INDEX huddle_participants_huddle_id_user_id_key ON public.huddle_participants USING btree (huddle_id, workspace_member_id);

CREATE UNIQUE INDEX huddle_participants_pkey ON public.huddle_participants USING btree (id);

CREATE UNIQUE INDEX huddle_transcripts_pkey ON public.huddle_transcripts USING btree (id);

CREATE UNIQUE INDEX huddles_pkey ON public.huddles USING btree (id);

CREATE INDEX idx_agent_mcp_access_agent_id ON public.agent_mcp_access USING btree (agent_id);

CREATE INDEX idx_agent_mcp_access_mcp_connection_id ON public.agent_mcp_access USING btree (mcp_connection_id);

CREATE INDEX idx_huddle_embeddings_huddle ON public.huddle_embeddings USING btree (huddle_id);

CREATE INDEX idx_huddle_embeddings_transcript ON public.huddle_embeddings USING btree (transcript_id);

CREATE INDEX idx_huddle_embeddings_vector ON public.huddle_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');

CREATE INDEX idx_huddle_participants_huddle ON public.huddle_participants USING btree (huddle_id);

CREATE INDEX idx_huddle_participants_workspace_member ON public.huddle_participants USING btree (workspace_member_id);

CREATE INDEX idx_huddle_transcripts_content_gin ON public.huddle_transcripts USING gin (to_tsvector('english'::regconfig, content));

CREATE INDEX idx_huddle_transcripts_huddle ON public.huddle_transcripts USING btree (huddle_id);

CREATE INDEX idx_huddle_transcripts_speaker ON public.huddle_transcripts USING btree (speaker_id);

CREATE INDEX idx_huddles_channel ON public.huddles USING btree (channel_id);

CREATE INDEX idx_huddles_conversation ON public.huddles USING btree (conversation_id);

CREATE INDEX idx_huddles_initiated_by ON public.huddles USING btree (initiated_by_workspace_member_id);

CREATE INDEX idx_huddles_workspace ON public.huddles USING btree (workspace_id);

CREATE INDEX idx_mcp_connections_status ON public.mcp_connections USING btree (status);

CREATE INDEX idx_mcp_connections_workspace_id ON public.mcp_connections USING btree (workspace_id);

CREATE INDEX idx_mcp_oauth_states_connection_id ON public.mcp_oauth_states USING btree (connection_id);

CREATE INDEX idx_mcp_oauth_states_expires_at ON public.mcp_oauth_states USING btree (expires_at);

CREATE INDEX idx_mcp_oauth_states_state ON public.mcp_oauth_states USING btree (state);

CREATE INDEX idx_message_mentions_entity_workspace ON public.message_mentions USING btree (mentioned_entity_id, workspace_id);

CREATE INDEX idx_message_mentions_message_id ON public.message_mentions USING btree (message_id);

CREATE INDEX idx_message_mentions_workspace_mentioned_at ON public.message_mentions USING btree (workspace_id, mentioned_at DESC);

CREATE INDEX idx_messages_slack_ts ON public.messages USING btree (((metadata ->> 'slack_ts'::text)));

CREATE INDEX idx_messages_webhook_id ON public.messages USING btree (webhook_id) WHERE (webhook_id IS NOT NULL);

CREATE INDEX idx_migration_jobs_created_at ON public.migration_jobs USING btree (created_at);

CREATE INDEX idx_migration_jobs_job_id ON public.migration_jobs USING btree (job_id);

CREATE INDEX idx_migration_jobs_status ON public.migration_jobs USING btree (status);

CREATE INDEX idx_migration_jobs_user_id ON public.migration_jobs USING btree (user_id);

CREATE INDEX idx_migration_jobs_workspace_id ON public.migration_jobs USING btree (workspace_id);

CREATE INDEX idx_migration_jobs_workspace_user_status ON public.migration_jobs USING btree (workspace_id, user_id, status);

CREATE INDEX idx_webhook_processing_errors_failed_at ON public.webhook_processing_errors USING btree (failed_at);

CREATE INDEX idx_webhook_processing_errors_request_id ON public.webhook_processing_errors USING btree (request_id);

CREATE INDEX idx_webhook_processing_errors_webhook_id ON public.webhook_processing_errors USING btree (webhook_id);

CREATE INDEX idx_webhook_unauthorized_attempts_attempted_at ON public.webhook_unauthorized_attempts USING btree (attempted_at);

CREATE INDEX idx_webhook_unauthorized_attempts_source_ip ON public.webhook_unauthorized_attempts USING btree (source_ip);

CREATE INDEX idx_webhook_unauthorized_attempts_webhook_id ON public.webhook_unauthorized_attempts USING btree (webhook_id);

CREATE INDEX idx_webhook_usage_source_ip ON public.webhook_usage USING btree (source_ip);

CREATE INDEX idx_webhook_usage_webhook_created ON public.webhook_usage USING btree (webhook_id, created_at);

CREATE INDEX idx_webhook_usage_webhook_id_created_at ON public.webhook_usage USING btree (webhook_id, created_at);

CREATE INDEX idx_webhooks_workspace_active ON public.webhooks USING btree (workspace_id, is_active);

CREATE INDEX idx_webhooks_workspace_creator ON public.webhooks USING btree (workspace_id, created_by_user_id);

CREATE INDEX idx_workspace_members_user_workspace_active ON public.workspace_members USING btree (user_id, workspace_id, is_deactivated);

CREATE UNIQUE INDEX mcp_connections_pkey ON public.mcp_connections USING btree (id);

CREATE UNIQUE INDEX mcp_connections_workspace_label_unique ON public.mcp_connections USING btree (workspace_id, server_label);

CREATE UNIQUE INDEX mcp_oauth_states_pkey ON public.mcp_oauth_states USING btree (id);

CREATE UNIQUE INDEX mcp_oauth_states_state_unique ON public.mcp_oauth_states USING btree (state);

CREATE UNIQUE INDEX message_mentions_pkey ON public.message_mentions USING btree (id);

CREATE UNIQUE INDEX migration_jobs_job_id_key ON public.migration_jobs USING btree (job_id);

CREATE UNIQUE INDEX migration_jobs_pkey ON public.migration_jobs USING btree (id);

CREATE UNIQUE INDEX unique_message_entity_mention ON public.message_mentions USING btree (message_id, mentioned_entity_id, mentioned_entity_type);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

CREATE UNIQUE INDEX webhook_processing_errors_pkey ON public.webhook_processing_errors USING btree (id);

CREATE UNIQUE INDEX webhook_unauthorized_attempts_pkey ON public.webhook_unauthorized_attempts USING btree (id);

CREATE UNIQUE INDEX webhook_usage_pkey ON public.webhook_usage USING btree (id);

CREATE UNIQUE INDEX webhooks_pkey ON public.webhooks USING btree (id);

alter table "public"."agent_mcp_access" add constraint "agent_mcp_access_pkey" PRIMARY KEY using index "agent_mcp_access_pkey";

alter table "public"."huddle_embeddings" add constraint "huddle_embeddings_pkey" PRIMARY KEY using index "huddle_embeddings_pkey";

alter table "public"."huddle_participants" add constraint "huddle_participants_pkey" PRIMARY KEY using index "huddle_participants_pkey";

alter table "public"."huddle_transcripts" add constraint "huddle_transcripts_pkey" PRIMARY KEY using index "huddle_transcripts_pkey";

alter table "public"."huddles" add constraint "huddles_pkey" PRIMARY KEY using index "huddles_pkey";

alter table "public"."mcp_connections" add constraint "mcp_connections_pkey" PRIMARY KEY using index "mcp_connections_pkey";

alter table "public"."mcp_oauth_states" add constraint "mcp_oauth_states_pkey" PRIMARY KEY using index "mcp_oauth_states_pkey";

alter table "public"."message_mentions" add constraint "message_mentions_pkey" PRIMARY KEY using index "message_mentions_pkey";

alter table "public"."migration_jobs" add constraint "migration_jobs_pkey" PRIMARY KEY using index "migration_jobs_pkey";

alter table "public"."webhook_processing_errors" add constraint "webhook_processing_errors_pkey" PRIMARY KEY using index "webhook_processing_errors_pkey";

alter table "public"."webhook_unauthorized_attempts" add constraint "webhook_unauthorized_attempts_pkey" PRIMARY KEY using index "webhook_unauthorized_attempts_pkey";

alter table "public"."webhook_usage" add constraint "webhook_usage_pkey" PRIMARY KEY using index "webhook_usage_pkey";

alter table "public"."webhooks" add constraint "webhooks_pkey" PRIMARY KEY using index "webhooks_pkey";

alter table "public"."agent_mcp_access" add constraint "agent_mcp_access_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE not valid;

alter table "public"."agent_mcp_access" validate constraint "agent_mcp_access_agent_id_fkey";

alter table "public"."agent_mcp_access" add constraint "agent_mcp_access_mcp_connection_id_fkey" FOREIGN KEY (mcp_connection_id) REFERENCES mcp_connections(id) ON DELETE CASCADE not valid;

alter table "public"."agent_mcp_access" validate constraint "agent_mcp_access_mcp_connection_id_fkey";

alter table "public"."agent_mcp_access" add constraint "agent_mcp_access_unique" UNIQUE using index "agent_mcp_access_unique";

alter table "public"."huddle_embeddings" add constraint "huddle_embeddings_huddle_id_fkey" FOREIGN KEY (huddle_id) REFERENCES huddles(id) ON DELETE CASCADE not valid;

alter table "public"."huddle_embeddings" validate constraint "huddle_embeddings_huddle_id_fkey";

alter table "public"."huddle_embeddings" add constraint "huddle_embeddings_transcript_id_fkey" FOREIGN KEY (transcript_id) REFERENCES huddle_transcripts(id) ON DELETE CASCADE not valid;

alter table "public"."huddle_embeddings" validate constraint "huddle_embeddings_transcript_id_fkey";

alter table "public"."huddle_participants" add constraint "huddle_participants_huddle_id_fkey" FOREIGN KEY (huddle_id) REFERENCES huddles(id) ON DELETE CASCADE not valid;

alter table "public"."huddle_participants" validate constraint "huddle_participants_huddle_id_fkey";

alter table "public"."huddle_participants" add constraint "huddle_participants_huddle_id_user_id_key" UNIQUE using index "huddle_participants_huddle_id_user_id_key";

alter table "public"."huddle_participants" add constraint "huddle_participants_role_check" CHECK (((role)::text = ANY ((ARRAY['host'::character varying, 'participant'::character varying, 'listener'::character varying])::text[]))) not valid;

alter table "public"."huddle_participants" validate constraint "huddle_participants_role_check";

alter table "public"."huddle_participants" add constraint "huddle_participants_workspace_member_id_fkey" FOREIGN KEY (workspace_member_id) REFERENCES workspace_members(id) not valid;

alter table "public"."huddle_participants" validate constraint "huddle_participants_workspace_member_id_fkey";

alter table "public"."huddle_transcripts" add constraint "huddle_transcripts_huddle_id_fkey" FOREIGN KEY (huddle_id) REFERENCES huddles(id) ON DELETE CASCADE not valid;

alter table "public"."huddle_transcripts" validate constraint "huddle_transcripts_huddle_id_fkey";

alter table "public"."huddle_transcripts" add constraint "huddle_transcripts_speaker_id_fkey" FOREIGN KEY (speaker_id) REFERENCES workspace_members(id) not valid;

alter table "public"."huddle_transcripts" validate constraint "huddle_transcripts_speaker_id_fkey";

alter table "public"."huddles" add constraint "huddles_channel_id_fkey" FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL not valid;

alter table "public"."huddles" validate constraint "huddles_channel_id_fkey";

alter table "public"."huddles" add constraint "huddles_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL not valid;

alter table "public"."huddles" validate constraint "huddles_conversation_id_fkey";

alter table "public"."huddles" add constraint "huddles_initiated_by_workspace_member_id_fkey" FOREIGN KEY (initiated_by_workspace_member_id) REFERENCES workspace_members(id) not valid;

alter table "public"."huddles" validate constraint "huddles_initiated_by_workspace_member_id_fkey";

alter table "public"."huddles" add constraint "huddles_status_check" CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'ended'::character varying, 'archived'::character varying])::text[]))) not valid;

alter table "public"."huddles" validate constraint "huddles_status_check";

alter table "public"."huddles" add constraint "huddles_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."huddles" validate constraint "huddles_workspace_id_fkey";

alter table "public"."mcp_connections" add constraint "mcp_connections_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(id) not valid;

alter table "public"."mcp_connections" validate constraint "mcp_connections_created_by_user_id_fkey";

alter table "public"."mcp_connections" add constraint "mcp_connections_status_check" CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'error'::character varying, 'pending_auth'::character varying])::text[]))) not valid;

alter table "public"."mcp_connections" validate constraint "mcp_connections_status_check";

alter table "public"."mcp_connections" add constraint "mcp_connections_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) not valid;

alter table "public"."mcp_connections" validate constraint "mcp_connections_workspace_id_fkey";

alter table "public"."mcp_connections" add constraint "mcp_connections_workspace_label_unique" UNIQUE using index "mcp_connections_workspace_label_unique";

alter table "public"."mcp_oauth_states" add constraint "mcp_oauth_states_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE CASCADE not valid;

alter table "public"."mcp_oauth_states" validate constraint "mcp_oauth_states_connection_id_fkey";

alter table "public"."mcp_oauth_states" add constraint "mcp_oauth_states_state_unique" UNIQUE using index "mcp_oauth_states_state_unique";

alter table "public"."mcp_oauth_states" add constraint "mcp_oauth_states_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) not valid;

alter table "public"."mcp_oauth_states" validate constraint "mcp_oauth_states_user_id_fkey";

alter table "public"."mcp_oauth_states" add constraint "mcp_oauth_states_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) not valid;

alter table "public"."mcp_oauth_states" validate constraint "mcp_oauth_states_workspace_id_fkey";

alter table "public"."message_mentions" add constraint "message_mentions_mentioned_entity_id_fkey" FOREIGN KEY (mentioned_entity_id) REFERENCES workspace_members(id) ON DELETE CASCADE not valid;

alter table "public"."message_mentions" validate constraint "message_mentions_mentioned_entity_id_fkey";

alter table "public"."message_mentions" add constraint "message_mentions_message_id_fkey" FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE not valid;

alter table "public"."message_mentions" validate constraint "message_mentions_message_id_fkey";

alter table "public"."message_mentions" add constraint "message_mentions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) not valid;

alter table "public"."message_mentions" validate constraint "message_mentions_workspace_id_fkey";

alter table "public"."message_mentions" add constraint "unique_message_entity_mention" UNIQUE using index "unique_message_entity_mention";

alter table "public"."messages" add constraint "messages_webhook_id_fkey" FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE SET NULL not valid;

alter table "public"."messages" validate constraint "messages_webhook_id_fkey";

alter table "public"."migration_jobs" add constraint "migration_jobs_job_id_key" UNIQUE using index "migration_jobs_job_id_key";

alter table "public"."migration_jobs" add constraint "migration_jobs_status_check" CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))) not valid;

alter table "public"."migration_jobs" validate constraint "migration_jobs_status_check";

alter table "public"."migration_jobs" add constraint "migration_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE not valid;

alter table "public"."migration_jobs" validate constraint "migration_jobs_user_id_fkey";

alter table "public"."migration_jobs" add constraint "migration_jobs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."migration_jobs" validate constraint "migration_jobs_workspace_id_fkey";

alter table "public"."users" add constraint "users_email_key" UNIQUE using index "users_email_key";

alter table "public"."webhook_processing_errors" add constraint "webhook_processing_errors_channel_id_fkey" FOREIGN KEY (channel_id) REFERENCES channels(id) not valid;

alter table "public"."webhook_processing_errors" validate constraint "webhook_processing_errors_channel_id_fkey";

alter table "public"."webhook_processing_errors" add constraint "webhook_processing_errors_webhook_id_fkey" FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE not valid;

alter table "public"."webhook_processing_errors" validate constraint "webhook_processing_errors_webhook_id_fkey";

alter table "public"."webhook_processing_errors" add constraint "webhook_processing_errors_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) not valid;

alter table "public"."webhook_processing_errors" validate constraint "webhook_processing_errors_workspace_id_fkey";

alter table "public"."webhook_unauthorized_attempts" add constraint "webhook_unauthorized_attempts_webhook_id_fkey" FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE not valid;

alter table "public"."webhook_unauthorized_attempts" validate constraint "webhook_unauthorized_attempts_webhook_id_fkey";

alter table "public"."webhook_usage" add constraint "webhook_usage_webhook_id_fkey" FOREIGN KEY (webhook_id) REFERENCES webhooks(id) not valid;

alter table "public"."webhook_usage" validate constraint "webhook_usage_webhook_id_fkey";

alter table "public"."webhooks" add constraint "webhooks_channel_id_fkey" FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL not valid;

alter table "public"."webhooks" validate constraint "webhooks_channel_id_fkey";

alter table "public"."webhooks" add constraint "webhooks_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(id) not valid;

alter table "public"."webhooks" validate constraint "webhooks_created_by_user_id_fkey";

alter table "public"."webhooks" add constraint "webhooks_source_type_check" CHECK ((source_type = ANY (ARRAY['custom'::text, 'github'::text, 'linear'::text, 'jira'::text, 'stripe'::text]))) not valid;

alter table "public"."webhooks" validate constraint "webhooks_source_type_check";

alter table "public"."webhooks" add constraint "webhooks_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) not valid;

alter table "public"."webhooks" validate constraint "webhooks_workspace_id_fkey";

alter table "public"."agents" add constraint "agents_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."agents" validate constraint "agents_workspace_id_fkey";

alter table "public"."call_participants" add constraint "call_participants_status_check" CHECK (((status)::text = ANY ((ARRAY['invited'::character varying, 'joined'::character varying, 'left'::character varying, 'declined'::character varying])::text[]))) not valid;

alter table "public"."call_participants" validate constraint "call_participants_status_check";

alter table "public"."calls" add constraint "calls_call_type_check" CHECK (((call_type)::text = ANY ((ARRAY['audio'::character varying, 'video'::character varying])::text[]))) not valid;

alter table "public"."calls" validate constraint "calls_call_type_check";

alter table "public"."calls" add constraint "calls_status_check" CHECK (((status)::text = ANY ((ARRAY['initiated'::character varying, 'ringing'::character varying, 'active'::character varying, 'ended'::character varying, 'missed'::character varying, 'declined'::character varying])::text[]))) not valid;

alter table "public"."calls" validate constraint "calls_status_check";

alter table "public"."channel_members" add constraint "channel_members_role_check" CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'member'::character varying])::text[]))) not valid;

alter table "public"."channel_members" validate constraint "channel_members_role_check";

alter table "public"."channels" add constraint "channels_channel_type_check" CHECK (((channel_type)::text = ANY ((ARRAY['public'::character varying, 'private'::character varying])::text[]))) not valid;

alter table "public"."channels" validate constraint "channels_channel_type_check";

alter table "public"."invites" add constraint "invites_status_check" CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'expired'::character varying, 'revoked'::character varying])::text[]))) not valid;

alter table "public"."invites" validate constraint "invites_status_check";

alter table "public"."notifications" add constraint "notifications_type_check" CHECK (((type)::text = ANY ((ARRAY['mention'::character varying, 'direct_message'::character varying, 'channel_message'::character varying, 'thread_reply'::character varying, 'system'::character varying])::text[]))) not valid;

alter table "public"."notifications" validate constraint "notifications_type_check";

alter table "public"."user_status" add constraint "user_status_status_check" CHECK (((status)::text = ANY ((ARRAY['online'::character varying, 'away'::character varying, 'busy'::character varying, 'offline'::character varying])::text[]))) not valid;

alter table "public"."user_status" validate constraint "user_status_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_states()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM public.mcp_oauth_states 
  WHERE expires_at < now();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN ARRAY(
    SELECT workspace_id 
    FROM workspace_members 
    WHERE user_id = (SELECT auth.uid() AS uid) 
    AND is_deactivated = false
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_migration_jobs_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

create or replace view "public"."webhook_security_summary" as  SELECT w.id,
    w.name,
    w.workspace_id,
    w.is_active,
    w.message_count,
    w.last_used_at,
    w.last_message_at,
    COALESCE(recent_usage.usage_count, (0)::bigint) AS usage_last_24h,
    COALESCE(recent_attempts.attempt_count, (0)::bigint) AS failed_attempts_last_24h,
    COALESCE(recent_errors.error_count, (0)::bigint) AS processing_errors_last_24h
   FROM (((webhooks w
     LEFT JOIN ( SELECT webhook_usage.webhook_id,
            count(*) AS usage_count
           FROM webhook_usage
          WHERE (webhook_usage.created_at > (now() - '24:00:00'::interval))
          GROUP BY webhook_usage.webhook_id) recent_usage ON ((w.id = recent_usage.webhook_id)))
     LEFT JOIN ( SELECT webhook_unauthorized_attempts.webhook_id,
            count(*) AS attempt_count
           FROM webhook_unauthorized_attempts
          WHERE (webhook_unauthorized_attempts.attempted_at > (now() - '24:00:00'::interval))
          GROUP BY webhook_unauthorized_attempts.webhook_id) recent_attempts ON ((w.id = recent_attempts.webhook_id)))
     LEFT JOIN ( SELECT webhook_processing_errors.webhook_id,
            count(*) AS error_count
           FROM webhook_processing_errors
          WHERE (webhook_processing_errors.failed_at > (now() - '24:00:00'::interval))
          GROUP BY webhook_processing_errors.webhook_id) recent_errors ON ((w.id = recent_errors.webhook_id)));


CREATE OR REPLACE FUNCTION public.claim_messages_for_embedding(batch_size integer)
 RETURNS TABLE(id uuid, workspace_id uuid, channel_id uuid, conversation_id uuid, parent_message_id uuid, created_at timestamp with time zone, body text, text text)
 LANGUAGE sql
 STABLE
AS $function$
WITH to_claim AS (
  SELECT id
    FROM messages
   WHERE needs_embedding = TRUE
     AND deleted_at IS NULL
   ORDER BY created_at, id
   LIMIT batch_size
   FOR UPDATE SKIP LOCKED
)
UPDATE messages
   SET needs_embedding = FALSE
 WHERE id IN (SELECT id FROM to_claim)
RETURNING
     id,
     workspace_id,
     channel_id,
     conversation_id,
     parent_message_id,
     created_at,
     body,
     text;
$function$
;

CREATE OR REPLACE FUNCTION public.expand_search_results_with_context(p_message_ids uuid[], p_max_hops integer DEFAULT 1)
 RETURNS TABLE(message_id uuid, hop_distance integer, linked_from uuid)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH RECURSIVE context_expansion AS (
    -- Base case: direct search results
    SELECT 
      unnest(p_message_ids) as message_id,
      0 as hop_distance,
      NULL::uuid as linked_from
    
    UNION
    
    -- Recursive case: follow context links
    SELECT 
      unnest(me.context_message_ids) as message_id,
      ce.hop_distance + 1,
      ce.message_id as linked_from
    FROM context_expansion ce
    JOIN message_embeddings me ON me.message_id = ce.message_id
    WHERE ce.hop_distance < p_max_hops
  )
  SELECT DISTINCT ON (message_id)
    message_id,
    hop_distance,
    linked_from
  FROM context_expansion
  ORDER BY message_id, hop_distance;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_semantic_neighbors(p_embedding vector, p_workspace_id uuid, p_exclude_message_id uuid, p_parent_message_id uuid DEFAULT NULL::uuid, p_channel_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid, p_time_window_hours integer DEFAULT 48, p_similarity_threshold double precision DEFAULT 0.7, p_limit integer DEFAULT 10)
 RETURNS TABLE(message_id uuid, similarity double precision, context_type text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    time_cutoff timestamp with time zone;
    current_message_created_at timestamp with time zone;
BEGIN
    time_cutoff := now() - (p_time_window_hours || ' hours')::interval;

    SELECT created_at INTO current_message_created_at 
    FROM messages WHERE id = p_exclude_message_id;

    RETURN QUERY
    WITH thread_context AS (
        -- Step 1: Get thread siblings/parent if applicable, limited to 5
        SELECT 
            me.message_id,
            (1 - (me.embedding <=> p_embedding)) AS similarity,
            CASE 
                WHEN m.id = p_parent_message_id THEN 'thread_parent'
                ELSE 'thread_sibling'
            END AS context_type
        FROM message_embeddings me
        JOIN messages m ON me.message_id = m.id
        WHERE 
            p_parent_message_id IS NOT NULL
            AND me.workspace_id = p_workspace_id
            AND me.message_id != p_exclude_message_id
            AND (m.id = p_parent_message_id OR m.parent_message_id = p_parent_message_id)
            AND me.created_at >= time_cutoff
        ORDER BY 
            CASE WHEN m.id = p_parent_message_id THEN 0 ELSE 1 END,
            m.created_at ASC
        LIMIT LEAST(p_limit, 5)
    ),
    temporal_context AS (
        -- Step 2: Get recent temporal context if there's room, limited to 3
        SELECT 
            me.message_id,
            (1 - (me.embedding <=> p_embedding)) AS similarity,
            'temporal_context' as context_type
        FROM message_embeddings me
        JOIN messages m ON me.message_id = m.id
        WHERE 
            me.workspace_id = p_workspace_id
            AND me.message_id != p_exclude_message_id
            AND (
                (p_channel_id IS NOT NULL AND m.channel_id = p_channel_id) OR
                (p_conversation_id IS NOT NULL AND m.conversation_id = p_conversation_id)
            )
            AND me.created_at >= time_cutoff
            -- Exclude messages already found in the thread context
            AND me.message_id NOT IN (SELECT tc.message_id FROM thread_context tc)
            -- Find messages within a 1-hour window of the source message
            AND abs(extract(epoch from (m.created_at - current_message_created_at))) <= 3600 
        ORDER BY abs(extract(epoch from (m.created_at - current_message_created_at))) ASC
        LIMIT LEAST(p_limit - (SELECT count(*) FROM thread_context), 3)
    ),
    semantic_context AS (
        -- Step 3: Fill the rest with the highest semantic similarity matches
        SELECT 
            me.message_id,
            (1 - (me.embedding <=> p_embedding)) AS similarity,
            'semantic_similar' AS context_type
        FROM message_embeddings me
        WHERE 
            me.workspace_id = p_workspace_id
            AND me.message_id != p_exclude_message_id
            AND me.created_at >= time_cutoff
            AND (1 - (me.embedding <=> p_embedding)) >= p_similarity_threshold
            -- Exclude messages from both previous steps
            AND me.message_id NOT IN (SELECT tc.message_id FROM thread_context tc)
            AND me.message_id NOT IN (SELECT tmp.message_id FROM temporal_context tmp)
        ORDER BY me.embedding <=> p_embedding ASC
        LIMIT p_limit - ((SELECT count(*) FROM thread_context) + (SELECT count(*) FROM temporal_context))
    )
    -- Combine all results
    SELECT * FROM thread_context
    UNION ALL
    SELECT * FROM temporal_context
    UNION ALL
    SELECT * FROM semantic_context;

END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_reaction_stats(message_id_param uuid)
 RETURNS TABLE(value text, count bigint, member_ids uuid[], user_reacted boolean)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    r.value,
    COUNT(*)::BIGINT as count,
    ARRAY_AGG(r.member_id) as member_ids,
    FALSE as user_reacted
  FROM reactions r
  WHERE r.message_id = message_id_param
  GROUP BY r.value
  ORDER BY count DESC, r.value;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.users (id, email, name, image)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.register_and_join_workspace(p_user_id uuid, p_user_email text, p_user_name text, p_invite_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    invite_record record;
    member_record record;
    workspace_record record;
BEGIN
    -- Step 1: Validate the invite token.
    -- We select the token and the associated workspace in one go.
    SELECT
        t.id, t.workspace_id, t.usage_count, t.max_uses, w.id as workspace_id, w.name as workspace_name
    INTO invite_record
    FROM workspace_invite_tokens t
    JOIN workspaces w ON t.workspace_id = w.id
    WHERE t.token = p_invite_token AND t.expires_at > now();

    -- Check if token exists and is not expired
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_INVITE_TOKEN: Invite token is invalid or has expired.';
    END IF;

    -- Check if token has reached its usage limit
    IF invite_record.max_uses IS NOT NULL AND invite_record.usage_count >= invite_record.max_uses THEN
        RAISE EXCEPTION 'INVITE_LIMIT_REACHED: Invite token has reached its usage limit.';
    END IF;

    -- Step 2: Create or update the user's public profile.
    -- This is safe to run even for existing users. If the user already has a
    -- profile, it will update their name.
    INSERT INTO users (id, email, name, last_workspace_id)
    VALUES (p_user_id, p_user_email, p_user_name, invite_record.workspace_id)
    ON CONFLICT (id) DO UPDATE
    SET
        name = EXCLUDED.name,
        last_workspace_id = EXCLUDED.last_workspace_id,
        updated_at = now();

    -- Step 3: Handle workspace membership.
    SELECT id, is_deactivated INTO member_record FROM workspace_members
    WHERE user_id = p_user_id AND workspace_id = invite_record.workspace_id;

    IF FOUND THEN
        IF member_record.is_deactivated THEN
            -- User was a member but was deactivated. Reactivate them.
            UPDATE workspace_members SET is_deactivated = false, updated_at = now()
            WHERE id = member_record.id;
        ELSE
            -- User is already an active member.
            RAISE EXCEPTION 'ALREADY_MEMBER: User is already a member of this workspace.';
        END IF;
    ELSE
        -- User is not a member. Add them.
        INSERT INTO workspace_members (user_id, workspace_id, role)
        VALUES (p_user_id, invite_record.workspace_id, 'member');
    END IF;

    -- Step 4: Increment the token's usage count.
    UPDATE workspace_invite_tokens
    SET usage_count = usage_count + 1, updated_at = now()
    WHERE id = invite_record.id;

    -- Step 5: Return the workspace info for the client response.
    SELECT id, name INTO workspace_record FROM workspaces WHERE id = invite_record.workspace_id;

    RETURN json_build_object(
        'id', workspace_record.id,
        'name', workspace_record.name
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_member_cascade(member_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Delete messages by this member
  DELETE FROM messages WHERE member_id = member_id_param;
  
  -- Delete reactions by this member
  DELETE FROM reactions WHERE member_id = member_id_param;
  
  -- Delete conversations where this member is involved
  DELETE FROM conversations 
  WHERE member_one_id = member_id_param OR member_two_id = member_id_param;
  
  -- Delete member
  DELETE FROM members WHERE id = member_id_param;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_needs_embedding_on_edit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only set needs_embedding if the body or text changed significantly
  IF OLD.body IS DISTINCT FROM NEW.body OR OLD.text IS DISTINCT FROM NEW.text THEN
    NEW.needs_embedding := true;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_workspace_embedding_usage(p_workspace_id uuid, p_month date, p_embeddings_increment integer DEFAULT 1, p_tokens_increment integer DEFAULT 0, p_cost_increment numeric DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO workspace_embedding_usage (
        workspace_id,
        month,
        total_embeddings_created,
        total_tokens_used,
        estimated_cost_usd,
        last_updated_at,
        created_at
    ) VALUES (
        p_workspace_id,
        p_month,
        p_embeddings_increment,
        p_tokens_increment,
        p_cost_increment,
        now(),
        now()
    )
    ON CONFLICT (workspace_id, month) 
    DO UPDATE SET
        total_embeddings_created = workspace_embedding_usage.total_embeddings_created + p_embeddings_increment,
        total_tokens_used = workspace_embedding_usage.total_tokens_used + p_tokens_increment,
        estimated_cost_usd = workspace_embedding_usage.estimated_cost_usd + p_cost_increment,
        last_updated_at = now();
END;
$function$
;


  create policy "Users can delete agent MCP access in their workspaces"
  on "public"."agent_mcp_access"
  as permissive
  for delete
  to public
using ((agent_id IN ( SELECT a.id
   FROM (agents a
     JOIN workspace_members wm ON ((a.workspace_id = wm.workspace_id)))
  WHERE ((wm.user_id = auth.uid()) AND (wm.is_deactivated = false)))));



  create policy "Users can insert agent MCP access in their workspaces"
  on "public"."agent_mcp_access"
  as permissive
  for insert
  to public
with check ((agent_id IN ( SELECT a.id
   FROM (agents a
     JOIN workspace_members wm ON ((a.workspace_id = wm.workspace_id)))
  WHERE ((wm.user_id = auth.uid()) AND (wm.is_deactivated = false)))));



  create policy "Users can update agent MCP access in their workspaces"
  on "public"."agent_mcp_access"
  as permissive
  for update
  to public
using ((agent_id IN ( SELECT a.id
   FROM (agents a
     JOIN workspace_members wm ON ((a.workspace_id = wm.workspace_id)))
  WHERE ((wm.user_id = auth.uid()) AND (wm.is_deactivated = false)))));



  create policy "Users can view agent MCP access in their workspaces"
  on "public"."agent_mcp_access"
  as permissive
  for select
  to public
using ((agent_id IN ( SELECT a.id
   FROM (agents a
     JOIN workspace_members wm ON ((a.workspace_id = wm.workspace_id)))
  WHERE ((wm.user_id = auth.uid()) AND (wm.is_deactivated = false)))));



  create policy "huddle_embeddings_access_policy"
  on "public"."huddle_embeddings"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM huddles h
  WHERE ((h.id = huddle_embeddings.huddle_id) AND is_workspace_member(h.workspace_id)))))
with check ((EXISTS ( SELECT 1
   FROM huddles h
  WHERE ((h.id = huddle_embeddings.huddle_id) AND is_workspace_member(h.workspace_id)))));



  create policy "huddle_participants_access_policy"
  on "public"."huddle_participants"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM huddles h
  WHERE ((h.id = huddle_participants.huddle_id) AND is_workspace_member(h.workspace_id)))))
with check ((EXISTS ( SELECT 1
   FROM huddles h
  WHERE ((h.id = huddle_participants.huddle_id) AND is_workspace_member(h.workspace_id)))));



  create policy "huddle_transcripts_access_policy"
  on "public"."huddle_transcripts"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM huddles h
  WHERE ((h.id = huddle_transcripts.huddle_id) AND is_workspace_member(h.workspace_id)))))
with check ((EXISTS ( SELECT 1
   FROM huddles h
  WHERE ((h.id = huddle_transcripts.huddle_id) AND is_workspace_member(h.workspace_id)))));



  create policy "huddles_access_policy"
  on "public"."huddles"
  as permissive
  for all
  to public
using (is_workspace_member(workspace_id))
with check (is_workspace_member(workspace_id));



  create policy "Users can delete MCP connections in their workspaces"
  on "public"."mcp_connections"
  as permissive
  for delete
  to public
using ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.is_deactivated = false)))));



  create policy "Users can insert MCP connections in their workspaces"
  on "public"."mcp_connections"
  as permissive
  for insert
  to public
with check ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.is_deactivated = false)))));



  create policy "Users can update MCP connections in their workspaces"
  on "public"."mcp_connections"
  as permissive
  for update
  to public
using ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.is_deactivated = false)))));



  create policy "Users can view MCP connections in their workspaces"
  on "public"."mcp_connections"
  as permissive
  for select
  to public
using ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.is_deactivated = false)))));



  create policy "Users can delete their OAuth states"
  on "public"."mcp_oauth_states"
  as permissive
  for delete
  to public
using ((user_id = auth.uid()));



  create policy "Users can insert their OAuth states"
  on "public"."mcp_oauth_states"
  as permissive
  for insert
  to public
with check ((user_id = auth.uid()));



  create policy "Users can view their OAuth states"
  on "public"."mcp_oauth_states"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "Service role can insert processing errors"
  on "public"."webhook_processing_errors"
  as permissive
  for insert
  to public
with check (true);



  create policy "Users can view processing errors for their workspace webhooks"
  on "public"."webhook_processing_errors"
  as permissive
  for select
  to public
using ((workspace_id = ANY (get_user_workspace_ids())));



  create policy "Service role can insert unauthorized attempts"
  on "public"."webhook_unauthorized_attempts"
  as permissive
  for insert
  to public
with check (true);



  create policy "Users can view unauthorized attempts for their workspace webhoo"
  on "public"."webhook_unauthorized_attempts"
  as permissive
  for select
  to public
using ((webhook_id IN ( SELECT webhooks.id
   FROM webhooks
  WHERE (webhooks.workspace_id = ANY (get_user_workspace_ids())))));



  create policy "Workspace admins can view all unauthorized attempts in their wo"
  on "public"."webhook_unauthorized_attempts"
  as permissive
  for select
  to public
using ((webhook_id IN ( SELECT w.id
   FROM (webhooks w
     JOIN workspace_members wm ON ((w.workspace_id = wm.workspace_id)))
  WHERE ((wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = 'admin'::text) AND (wm.is_deactivated = false)))));



  create policy "Service role can insert webhook usage"
  on "public"."webhook_usage"
  as permissive
  for insert
  to public
with check (true);



  create policy "Users can view webhook usage in their workspaces"
  on "public"."webhook_usage"
  as permissive
  for select
  to public
using ((webhook_id IN ( SELECT webhooks.id
   FROM webhooks
  WHERE (webhooks.workspace_id = ANY (get_user_workspace_ids())))));



  create policy "Workspace admins can view all webhook usage in their workspace"
  on "public"."webhook_usage"
  as permissive
  for select
  to public
using ((webhook_id IN ( SELECT w.id
   FROM (webhooks w
     JOIN workspace_members wm ON ((w.workspace_id = wm.workspace_id)))
  WHERE ((wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = 'admin'::text) AND (wm.is_deactivated = false)))));



  create policy "Users can delete webhooks they created in their workspaces"
  on "public"."webhooks"
  as permissive
  for delete
  to public
using (((workspace_id = ANY (get_user_workspace_ids())) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));



  create policy "Users can insert webhooks in their workspaces"
  on "public"."webhooks"
  as permissive
  for insert
  to public
with check (((workspace_id = ANY (get_user_workspace_ids())) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));



  create policy "Users can update webhooks they created in their workspaces"
  on "public"."webhooks"
  as permissive
  for update
  to public
using (((workspace_id = ANY (get_user_workspace_ids())) AND (created_by_user_id = ( SELECT auth.uid() AS uid))))
with check (((workspace_id = ANY (get_user_workspace_ids())) AND (created_by_user_id = ( SELECT auth.uid() AS uid))));



  create policy "Users can view webhooks in their workspaces"
  on "public"."webhooks"
  as permissive
  for select
  to public
using ((workspace_id = ANY (get_user_workspace_ids())));



  create policy "Workspace admins can delete any webhook in their workspace"
  on "public"."webhooks"
  as permissive
  for delete
  to public
using ((workspace_id IN ( SELECT wm.workspace_id
   FROM workspace_members wm
  WHERE ((wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = 'admin'::text) AND (wm.is_deactivated = false)))));



  create policy "Workspace admins can update any webhook in their workspace"
  on "public"."webhooks"
  as permissive
  for update
  to public
using ((workspace_id IN ( SELECT wm.workspace_id
   FROM workspace_members wm
  WHERE ((wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = 'admin'::text) AND (wm.is_deactivated = false)))))
with check ((workspace_id IN ( SELECT wm.workspace_id
   FROM workspace_members wm
  WHERE ((wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.role = 'admin'::text) AND (wm.is_deactivated = false)))));


CREATE TRIGGER trigger_migration_jobs_updated_at BEFORE UPDATE ON public.migration_jobs FOR EACH ROW EXECUTE FUNCTION update_migration_jobs_updated_at();


