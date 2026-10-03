// Local interface translations only. Country labels and original posts stay intact.
(function(root){
  const languages=['ja','zh_CN','fr','es','it'];
  const rows=`Reset propagation fix|リセット反映の修正|重置到账修复|Correction de propagation du reset|Corrección de propagación del reset|Correzione della propagazione del reset
Reset investigation and remediation|リセット調査・補償|重置调查与补偿|Enquête et correction du reset|Investigación y corrección del reset|Indagine e correzione del reset
Reset update|リセット続報|重置后续|Suivi du reset|Actualización del reset|Aggiornamento del reset
Follow-up post|続報|后续公告|Publication de suivi|Publicación de seguimiento|Post di aggiornamento
Reset announcements, updates and credit grants|リセット予告・続報・付与通知|重置预告、后续和重置券通知|Annonces, suivis et crédits de reset|Anuncios, actualizaciones y créditos de reset|Annunci, aggiornamenti e crediti di reset
Reset propagation investigation and remediation · additional reset and timing unconfirmed|リセット反映の調査・補償案内 · 追加リセット・時刻は未確定|重置未到账问题调查与补偿说明 · 额外重置及时间未确认|Enquête et correction de propagation · reset supplémentaire et horaire non confirmés|Investigación y corrección de propagación · reset adicional y horario sin confirmar|Indagine e correzione della propagazione · reset aggiuntivo e orario non confermati
Reset propagation fix · additional grants and your account recovery need separate confirmation|リセット反映の修正案内 · 追加付与・自分の利用枠回復は別途確認|重置到账修复说明 · 额外发放和个人额度恢复需另行确认|Correction de propagation · crédits supplémentaires et récupération de votre compte à vérifier|Corrección de propagación · créditos adicionales y recuperación de tu cuenta por confirmar|Correzione della propagazione · crediti aggiuntivi e recupero del tuo account da verificare
Notifies once about qualifying reset announcements, follow-up fixes, completed resets and banked reset grants. Your own quota recovery is checked separately.|対象のリセット予告・続報・完了・付与を一度通知します。自分の利用枠回復は別途確認します。|对符合条件的重置预告、后续修复、完成和重置券发放各通知一次。个人额度恢复单独确认。|Signale une fois les annonces, corrections, resets terminés et crédits admissibles. La récupération de votre quota est vérifiée séparément.|Avisa una vez de anuncios, correcciones, resets completados y créditos válidos. Tu recuperación de cuota se comprueba por separado.|Avvisa una volta per annunci, correzioni, reset completati e crediti validi. Il recupero della tua quota è verificato separatamente.
Only plans matching your signed-in account type can be selected.|ログイン中のアカウントと同じ種類のプランのみ選択できます。|只能选择与已登录账户类型相同的套餐。|Seuls les forfaits correspondant au type de votre compte connecté peuvent être sélectionnés.|Solo puedes seleccionar planes del mismo tipo que tu cuenta conectada.|Puoi selezionare solo piani dello stesso tipo del tuo account connesso.
The displayed time is the post time. Check your account separately for the actual grant or reset time.|表示時刻は投稿時刻です。実際の付与・リセット時刻はアカウントで別途確認してください。|显示的是发帖时间。实际发放或重置时间请另行查看账户。|L’heure affichée est celle du post. Vérifiez votre compte pour l’heure réelle d’attribution ou de reset.|La hora mostrada es la del post. Comprueba tu cuenta para confirmar la hora real de entrega o reset.|L’ora mostrata è quella del post. Controlla il tuo account per l’ora effettiva di assegnazione o reset.
The scheduled time may already have passed.|予定時刻はすでに過ぎている可能性があります。|预告时间可能已经过去。|L’heure prévue est peut-être déjà passée.|Es posible que la hora prevista ya haya pasado.|L’orario previsto potrebbe essere già passato.
The author reports a completed reset. Check your remaining quota to confirm it reached your account.|投稿者はリセット完了を報告しています。自分のアカウントへの反映は残りの利用枠で確認してください。|作者报告重置已完成。请查看剩余额度，确认你的账户是否已更新。|L’auteur annonce un reset terminé. Vérifiez votre quota restant pour confirmer son application à votre compte.|El autor anuncia un reset completado. Comprueba tu cuota restante para confirmar que se aplicó a tu cuenta.|L’autore segnala un reset completato. Controlla la quota residua per confermare che sia stato applicato al tuo account.
Credit grant notice. A grant does not automatically reset your quota.|リセット券の付与案内です。付与だけで利用枠が自動リセットされるわけではありません。|重置券发放通知。发放重置券不会自动重置额度。|Avis d’attribution de crédits. Leur attribution ne réinitialise pas automatiquement votre quota.|Aviso de entrega de créditos. La entrega no reinicia automáticamente tu cuota.|Avviso di assegnazione di crediti. L’assegnazione non reimposta automaticamente la quota.
Official schedule · Pinned|公式日程・固定|官方日程 · 置顶|Programme officiel · Épinglé|Programa oficial · Fijado|Programma ufficiale · In evidenza
Ends · Korea|終了・韓国|结束 · 韩国|Fin · Corée|Fin · Corea|Fine · Corea
Event schedule|イベント日程|活动日程|Calendrier des événements|Calendario de eventos|Calendario eventi
Related posts|関連投稿を見る|查看相关帖子|Voir les publications liées|Ver publicaciones relacionadas|Vedi i post correlati
Detected updates · Resets first|検出した情報・リセット優先|已检测消息 · 重置优先|Actualités détectées · Resets en premier|Novedades detectadas · Reinicios primero|Novità rilevate · Reset prima
Upcoming · Pinned|開催予定・固定|即将举行 · 置顶|À venir · Épinglé|Próximo · Fijado|In programma · In evidenza
Live · Pinned|開催中・固定|进行中 · 置顶|En cours · Épinglé|En curso · Fijado|In corso · In evidenza
Official schedule ↗|公式日程 ↗|官方日程 ↗|Programme officiel ↗|Programa oficial ↗|Programma ufficiale ↗
Keynote|基調講演|主题演讲|Conférence principale|Presentación principal|Presentazione principale
Time unconfirmed|時刻未定|时间待定|Heure à confirmer|Hora por confirmar|Orario da confermare
End unconfirmed · Pinned through the event day|終了未定・開催日終了まで仮固定|结束时间未定 · 暂置顶至活动日结束|Fin à confirmer · Épinglé jusqu’à la fin du jour de l’événement|Fin por confirmar · Fijado hasta el final del día del evento|Fine da confermare · In evidenza fino a fine giornata
Date inferred|日付は推定|日期为推测|Date estimée|Fecha estimada|Data stimata
Next|次の|下个|Prochain|Próximo|Prossimo
This|今|本|Ce|Este|Questo
Hint, launch and event alerts|示唆・新製品・イベント通知|暗示、新品与活动提醒|Alertes indices, lancements et événements|Alertas de indicios, lanzamientos y eventos|Avvisi indizi, lanci ed eventi
Reset & launch news|リセット・新製品情報|重置与新品消息|Resets et nouveautés|Reinicios y lanzamientos|Reset e novità
Event|イベント|活动|Événement|Evento|Evento
Launch|新製品|新品|Lancement|Lanzamiento|Lancio
Reset unconfirmed|リセット未確認|重置未确认|Reset non confirmé|Reinicio sin confirmar|Reset non confermato
Tibo · VB updates|Tibo・VB リセット情報|Tibo · VB 重置消息|Actualités Tibo · VB|Novedades Tibo · VB|Novità Tibo · VB
Tibo · VB sources|Tibo・VB の情報源|Tibo · VB 信息源|Sources Tibo · VB|Fuentes Tibo · VB|Fonti Tibo · VB
Tibo · VB on Codex|Tibo・VB の Codex 情報|Tibo · VB 的 Codex 消息|Codex par Tibo · VB|Codex por Tibo · VB|Codex da Tibo · VB
Tibo · VB monitoring off|Tibo・VB の監視オフ|Tibo · VB 监测已关闭|Suivi Tibo · VB désactivé|Seguimiento Tibo · VB desactivado|Monitoraggio Tibo · VB disattivato
Resets may arrive later than announced|予告より遅れる場合があります|重置可能晚于预告时间|Le reset peut être retardé|El reset puede retrasarse|Il reset può ritardare
No quota data yet|利用枠の情報がありません|暂无额度信息|Quota non disponible|Sin datos de cuota|Quota non disponibile
Reset time unknown|リセット時刻未確認|重置时间未知|Heure de reset inconnue|Hora de reset desconocida|Ora del reset sconosciuta
Connect your account to check your plan and models.|アカウント接続後にプランとモデルを確認します。|连接账户后查看套餐和模型。|Connectez votre compte pour vérifier votre offre et vos modèles.|Conecta tu cuenta para consultar tu plan y modelos.|Collega l’account per verificare piano e modelli.
Reads your signed-in plan; no assumed quota.|ログイン中のプランを確認し、上限を仮定しません。|读取当前登录账户的套餐，不预设额度。|Offre du compte connecté, sans quota présumé.|Plan de la cuenta conectada, sin suponer cuotas.|Piano dell’account connesso, senza quote presunte.
Local counter sync only; not a verified Chat server reset or remaining quota.|ローカル集計の同期です。Chat 側のリセットや残数の確認値ではありません。|仅同步本地计数，未验证 Chat 服务器的重置或剩余额度。|Synchronisation locale uniquement, sans vérification du quota ni du reset côté Chat.|Solo sincronización local; no verifica el reset ni la cuota del servidor Chat.|Solo sincronizzazione locale, senza verificare reset o quota del server Chat.
Hints are unconfirmed · Chat counts are estimates|候補は未確定・Chat 残数は推定|线索未确认 · Chat 计数为估算|Indices non confirmés · Compteurs estimés|Indicios sin confirmar · Recuentos estimados|Indizi non confermati · Conteggi stimati
Direct replies off · Connect in settings|返信の直接確認オフ・設定で接続|直接读取回复已关闭 · 请在设置中连接|Lecture des réponses désactivée · Voir les réglages|Lectura de respuestas desactivada · Ver ajustes|Lettura risposte disattivata · Vedi impostazioni
Check X connection in settings|設定で X 接続を確認|请在设置中检查 X 连接|Vérifiez la connexion X|Revisa la conexión con X|Verifica la connessione X
Older scan · Press Check now|以前の記録・今すぐ確認してください|旧记录 · 请点击立即检查|Ancien relevé · Actualisez|Registro antiguo · Actualiza|Dati precedenti · Aggiorna
Collection error · Saved updates|取得エラー・保存済み情報|收集出错 · 显示已保存消息|Erreur de collecte · Données conservées|Error de recopilación · Datos guardados|Errore di raccolta · Dati salvati
Could not load updates|情報を取得できませんでした|无法加载消息|Impossible de charger les actualités|No se pudieron cargar las novedades|Impossibile caricare le novità
Check the latest collection status|最新の取得状況を確認してください|请检查最新收集状态|Vérifiez l’état de la collecte|Comprueba el estado de recopilación|Verifica lo stato della raccolta
No new reset updates|新しいリセット情報はありません|暂无新重置消息|Aucune nouvelle de reset|Sin novedades de reset|Nessuna novità sul reset
Checking for updates|新しい情報を確認中|正在检查新消息|Recherche d’actualités|Buscando novedades|Ricerca di novità
Preview · Example data · No real notifications|プレビュー・サンプルデータ・実際の通知なし|预览 · 示例数据 · 不发送实际通知|Aperçu · Données fictives · Aucune notification réelle|Vista previa · Datos de ejemplo · Sin notificaciones reales|Anteprima · Dati di esempio · Nessuna notifica reale
Reset Radar|リセットレーダー|重置雷达|Radar de reset|Radar de reset|Radar reset
Open settings|設定を開く|打开设置|Ouvrir les réglages|Abrir ajustes|Apri impostazioni
Country|国|国家|Pays|País|Paese
Country · Language|国|国家|Pays|País|Paese
Select country|国を選択|选择国家|Choisir un pays|Elegir país|Scegli paese
Settings sections|設定項目|设置分类|Sections des réglages|Secciones de ajustes|Sezioni impostazioni
Read public X pages|X の公開ページを確認|读取 X 公开页面|Lire les pages publiques X|Leer páginas públicas de X|Leggi pagine pubbliche X
My quota and reset credits|自分の利用枠・リセット券|我的额度与重置券|Mon quota et mes crédits de reset|Mi cuota y créditos de reset|Quota e crediti reset
Count Chat usage|Chat の利用回数を集計|统计 Chat 使用次数|Compter l’utilisation de Chat|Contar usos de Chat|Conta utilizzi Chat
Connect account history to include other devices|他の端末の利用分は履歴接続後に確認|连接账户记录后统计其他设备的使用量|Connectez l’historique pour inclure les autres appareils|Conecta el historial para incluir otros dispositivos|Collega la cronologia per includere altri dispositivi
ChatGPT connection|ChatGPT 接続|ChatGPT 连接|Connexion ChatGPT|Conexión con ChatGPT|Connessione ChatGPT
Quota is connected.|利用枠に接続済みです。|额度已连接。|Quota connecté.|Cuota conectada.|Quota collegata.
Community reset history|コミュニティのリセット記録|社区重置记录|Historique communautaire|Historial de la comunidad|Cronologia della comunità
Latest collected post:|最新の取得投稿:|最近收集的帖子:|Dernier post collecté :|Última publicación recopilada:|Ultimo post raccolto:
Coverage is limited. Only reset-related posts appear in the popup.|全件取得は保証されません。リセット関連の投稿のみ表示します。|无法保证完整收集。弹窗仅显示与重置有关的帖子。|Collecte limitée. Seuls les posts liés aux resets sont affichés.|Cobertura limitada. Solo se muestran publicaciones sobre resets.|Copertura limitata. Sono mostrati solo i post sui reset.
Unique posts|重複除外|去重帖子|Posts uniques|Publicaciones únicas|Post unici
Some conversations could not be read|一部の会話を取得できませんでした|部分对话读取失败|Certaines conversations sont indisponibles|Algunas conversaciones no se pudieron leer|Alcune conversazioni non sono leggibili
Partly truncated|一部省略|部分省略|Partiellement tronqué|Parcialmente recortado|Parzialmente troncato
Ready. Use the test button to check Windows notifications.|準備完了。テストボタンで Windows 通知を確認してください。|已就绪。请点击测试按钮检查 Windows 通知。|Prêt. Testez les notifications Windows avec le bouton.|Listo. Usa el botón para probar las notificaciones de Windows.|Pronto. Usa il pulsante per provare le notifiche Windows.
Running version unavailable|実行バージョン未確認|无法确认运行版本|Version active indisponible|Versión activa no disponible|Versione attiva non disponibile
Extension quiet hours active|拡張機能のおやすみ時間中|扩展勿扰时段已开启|Heures silencieuses actives|Horario silencioso activo|Orario silenzioso attivo
Last delivery:|前回の配信:|最近发送:|Dernier envoi :|Último envío:|Ultimo invio:
Accepted by Chrome|Chrome が受理|Chrome 已接收|Accepté par Chrome|Aceptado por Chrome|Accettato da Chrome
Quota recovery alerts|利用枠回復の通知|额度恢复通知|Alertes de quota rétabli|Avisos de cuota recuperada|Avvisi di quota ripristinata
Enable quiet hours|おやすみ時間を有効にする|启用勿扰时段|Activer les heures silencieuses|Activar horario silencioso|Attiva orario silenzioso
Quiet hours start|おやすみ開始時刻|勿扰开始时间|Début des heures silencieuses|Inicio del horario silencioso|Inizio orario silenzioso
Quiet hours end|おやすみ終了時刻|勿扰结束时间|Fin des heures silencieuses|Fin del horario silencioso|Fine orario silenzioso
Quiet hours|おやすみ時間|勿扰时段|Heures silencieuses|Horario silencioso|Orario silenzioso
Clear local data|ローカルデータを消去|清除本地数据|Effacer les données locales|Borrar datos locales|Cancella dati locali
UI v|画面 v|界面 v|Interface v|Interfaz v|Interfaccia v
Worker v|実行 v|运行 v|Exécution v|Ejecución v|Esecuzione v
Hint alerts|候補の通知|线索通知|Alertes d’indices|Avisos de indicios|Avvisi di indizi
Notifications allowed|通知許可|通知已允许|Notifications autorisées|Notificaciones permitidas|Notifiche consentite
Notifications blocked|通知ブロック|通知已阻止|Notifications bloquées|Notificaciones bloqueadas|Notifiche bloccate
On|オン|开启|Activé|Activado|Attivo
Conversations|会話|对话|Conversations|Conversaciones|Conversazioni
Pending|待機|待处理|En attente|Pendiente|In attesa
Failed|失敗|失败|Échec|Error|Errore
Checked:|確認:|已检查:|Vérifié :|Revisado:|Verificato:
remaining quota|残りの利用枠|剩余额度|quota restant|cuota restante|quota residua
Detected updates · Newest first|検出した情報・新しい順|检测消息 · 最新优先|Actualités détectées · Plus récentes d’abord|Novedades detectadas · Más recientes primero|Novità rilevate · Più recenti prima
Time zone unspecified|タイムゾーン未記載|未注明时区|Fuseau non précisé|Zona horaria sin indicar|Fuso non specificato
Korea time unknown|韓国時刻未定|韩国时间待定|Heure coréenne inconnue|Hora coreana sin definir|Ora coreana non definita
Time not announced|日時未定|时间待定|Date non annoncée|Fecha sin anunciar|Data non annunciata
Reset type unspecified|リセット種別未確認|重置类型未明确|Type de reset non précisé|Tipo de reset sin especificar|Tipo di reset non specificato
Quota + banked reset|通常＋Banked reset|普通重置 + Banked reset|Quota + banked reset|Cuota + banked reset|Quota + banked reset
Quota reset|通常リセット|普通额度重置|Reset du quota|Reset de cuota|Reset della quota
reset done|reset 完了|reset 完成|reset effectué|reset completado|reset completato
Credit grant|リセット券付与|发放重置券|Crédits accordés|Créditos otorgados|Crediti assegnati
Completion post|完了のお知らせ|完成公告|Annonce de fin|Aviso de finalización|Annuncio di completamento
View post|原文を見る|查看原文|Voir le post|Ver publicación|Vedi post
Post opened ↗|原文を開きました ↗|已打开原文 ↗|Post ouvert ↗|Publicación abierta ↗|Post aperto ↗
Try again ↗|もう一度開く ↗|重试 ↗|Réessayer ↗|Reintentar ↗|Riprova ↗
Opening…|開いています…|正在打开…|Ouverture…|Abriendo…|Apertura…
Credits · Status|リセット券・状態|重置券 · 状态|Crédits · État|Créditos · Estado|Crediti · Stato
Sync account history · All devices|アカウント履歴同期・全端末|同步账户记录 · 所有设备|Synchroniser l’historique · Tous appareils|Sincronizar historial · Todos los dispositivos|Sincronizza cronologia · Tutti i dispositivi
Chat · Account and model counts|Chat・接続とモデル別集計|Chat · 账户与模型计数|Chat · Compte et compteurs|Chat · Cuenta y recuentos|Chat · Account e conteggi
Restart Chat counters on Codex reset|Codex リセット時に Chat 集計も初期化|Codex 重置时清零 Chat 计数|Repartir à zéro avec le reset Codex|Reiniciar contadores con el reset de Codex|Azzera contatori al reset Codex
Reset announcements and credit grants|リセット予告・完了・券付与の通知|重置预告、完成与重置券通知|Annonces de resets et de crédits|Anuncios de reset y créditos|Annunci di reset e crediti
Metaphor and hint alerts|比喩・暗示候補の通知|隐喻与暗示线索通知|Alertes de métaphores et indices|Avisos de metáforas e indicios|Avvisi di metafore e indizi
Catch up on quota recovery after restart|再起動後に見逃した回復を通知|重启后补发额度恢复通知|Rattrapage du quota après redémarrage|Recuperación de cuota al reiniciar|Recupero quota dopo il riavvio
Catch up on missed public updates|再開時に見逃した公開情報を通知|恢复后补发错过的公开消息|Rattrapage des actualités manquées|Recuperar avisos públicos pendientes|Recupera aggiornamenti persi
Low quota guidance|利用枠不足時の案内|低额度使用建议|Conseils de quota faible|Consejos con cuota baja|Consigli con quota bassa
Schedule change alerts|予定変更の通知|计划变更通知|Alertes de changement de date|Avisos de cambio de fecha|Avvisi di cambio programma
Read X posts and replies · Optional|X の投稿・返信を直接確認・任意|直接读取 X 帖子和回复 · 可选|Lire posts et réponses X · Facultatif|Leer posts y respuestas X · Opcional|Leggi post e risposte X · Facoltativo
My quota and reset credits · Optional|自分の利用枠・リセット券・任意|我的额度与重置券 · 可选|Mon quota et crédits · Facultatif|Mi cuota y créditos · Opcional|Quota e crediti · Facoltativo
Post and reply collection|投稿・返信の取得状況|帖子与回复收集状态|Collecte des posts et réponses|Recopilación de posts y respuestas|Raccolta post e risposte
ChatGPT session · Optional background requests|ChatGPT セッション・任意のバックグラウンド確認|ChatGPT 会话 · 可选后台查询|Session ChatGPT · Requêtes facultatives|Sesión ChatGPT · Consultas opcionales|Sessione ChatGPT · Richieste facoltative
4 public sources|公開情報源 4 件|4 个公开来源|4 sources publiques|4 fuentes públicas|4 fonti pubbliche
Sources and weights|情報源と重み|来源与权重|Sources et pondération|Fuentes y ponderación|Fonti e pesi
Could not save the theme. Try again.|テーマを保存できません。もう一度お試しください。|无法保存主题，请重试。|Impossible d’enregistrer le thème. Réessayez.|No se pudo guardar el tema. Reinténtalo.|Impossibile salvare il tema. Riprova.
Theme saved.|テーマを保存しました。|主题已保存。|Thème enregistré.|Tema guardado.|Tema salvato.
Could not save the language. Try again.|言語を保存できません。もう一度お試しください。|无法保存语言，请重试。|Impossible d’enregistrer la langue. Réessayez.|No se pudo guardar el idioma. Reinténtalo.|Impossibile salvare la lingua. Riprova.
Language saved.|言語を保存しました。|语言已保存。|Langue enregistrée.|Idioma guardado.|Lingua salvata.
Theme|テーマ|主题|Thème|Tema|Tema
Light|ライト|浅色|Clair|Claro|Chiaro
Dark|ダーク|深色|Sombre|Oscuro|Scuro
System|システム|跟随系统|Système|Sistema|Sistema
Remaining quota|残りの利用枠|剩余额度|Quota restant|Cuota restante|Quota residua
Unknown|未確認|未知|Inconnu|Desconocido|Sconosciuto
Account lookup off|アカウント確認オフ|账户查询已关闭|Lecture du compte désactivée|Consulta de cuenta desactivada|Lettura account disattivata
Connect to view|接続後に表示|连接后显示|Connectez-vous pour voir|Conecta para ver|Collega per visualizzare
Account disconnected|アカウント未接続|账户未连接|Compte déconnecté|Cuenta desconectada|Account scollegato
Account not checked|アカウント未確認|账户未检查|Compte non vérifié|Cuenta sin verificar|Account non verificato
Check plan again|プランを再確認|重新检查套餐|Revérifier l’offre|Revisar plan|Ricontrolla piano
Check plan|プラン確認|检查套餐|Vérifier l’offre|Consultar plan|Verifica piano
Connect history|履歴を接続|连接记录|Connecter l’historique|Conectar historial|Collega cronologia
Connect account|アカウント接続|连接账户|Connecter le compte|Conectar cuenta|Collega account
Check connection|接続を確認|检查连接|Vérifier la connexion|Verificar conexión|Verifica connessione
Sync now|今すぐ同期|立即同步|Synchroniser|Sincronizar|Sincronizza
Sign in to ChatGPT|ChatGPT にログイン|登录 ChatGPT|Se connecter à ChatGPT|Iniciar sesión en ChatGPT|Accedi a ChatGPT
Open ChatGPT|ChatGPT を開く|打开 ChatGPT|Ouvrir ChatGPT|Abrir ChatGPT|Apri ChatGPT
Checking connection…|接続を確認中…|正在检查连接…|Vérification…|Verificando conexión…|Verifica connessione…
5-hour|5時間|5 小时|5 heures|5 horas|5 ore
Weekly|週間|每周|Hebdomadaire|Semanal|Settimanale
Reset credits|リセット券|重置券|Crédits de reset|Créditos de reset|Crediti reset
Guidance|利用案内|使用建议|Conseils|Consejos|Consigli
Alerts on|通知オン|通知已开启|Alertes activées|Avisos activados|Avvisi attivi
Alerts off|通知オフ|通知已关闭|Alertes désactivées|Avisos desactivados|Avvisi disattivati
Updates off|情報確認オフ|消息检查已关闭|Actualités désactivées|Novedades desactivadas|Novità disattivate
Check public updates|公開情報を確認|检查公开消息|Vérifier les actualités|Consultar novedades|Verifica novità
Public reset updates|公開リセット情報|公开重置消息|Actualités des resets|Novedades de resets|Novità sui reset
Estimated timing · Unconfirmed|推定時刻・未確定|预估时间 · 未确认|Date estimée · Non confirmée|Hora estimada · Sin confirmar|Orario stimato · Non confermato
Reset schedule changed|リセット予定変更|重置计划已变更|Date de reset modifiée|Fecha de reset modificada|Programma reset modificato
Reset postponed|リセット延期|重置已推迟|Reset reporté|Reset pospuesto|Reset rinviato
Change notice|変更のお知らせ|变更通知|Avis de changement|Aviso de cambio|Avviso di modifica
Earlier announcement|以前の予告|之前的预告|Annonce précédente|Anuncio anterior|Annuncio precedente
Update ↗|変更投稿 ↗|变更原文 ↗|Mise à jour ↗|Actualización ↗|Aggiornamento ↗
Earlier post ↗|以前の投稿 ↗|之前的原文 ↗|Post précédent ↗|Post anterior ↗|Post precedente ↗
Notification connection|通知の接続確認|通知连接状态|Connexion des notifications|Conexión de notificaciones|Connessione notifiche
Test Windows notifications|Windows 通知をテスト|测试 Windows 通知|Tester les notifications Windows|Probar notificaciones de Windows|Prova notifiche Windows
Checking running version…|実行バージョンを確認中…|正在检查运行版本…|Vérification de la version…|Verificando versión…|Verifica versione…
Custom time zone|タイムゾーンを入力|自定义时区|Fuseau personnalisé|Zona horaria personalizada|Fuso personalizzato
Time display|時刻表示|时间显示|Affichage de l’heure|Formato de hora|Visualizzazione ora
Community edition|コミュニティ版|社区版|Édition communautaire|Edición comunitaria|Edizione comunitaria
Korean|韓国語|韩语|Coréen|Coreano|Coreano
Hint|候補|线索|Indice|Indicio|Indizio
Est. left|推定残数|估计剩余|Restant estimé|Restante estimado|Residuo stimato
Est. by model|モデル別推定|按模型估算|Estimation par modèle|Estimación por modelo|Stima per modello
History count|履歴集計|记录统计|Compteur historique|Recuento histórico|Conteggio cronologia
Observed in Chrome|Chrome で観測|Chrome 观测|Observé dans Chrome|Observado en Chrome|Osservato in Chrome
Remaining unknown|残数未確認|剩余未知|Restant inconnu|Restante desconocido|Residuo sconosciuto
Daily and weekly limits|日次・週次上限を反映|计入每日及每周限额|Limites journalières et hebdomadaires|Límites diarios y semanales|Limiti giornalieri e settimanali
Limit not checked|上限未確認|限额未检查|Limite non vérifiée|Límite sin verificar|Limite non verificato
Shared monthly|月次共有枠|共享月限额|Mensuel partagé|Mensual compartido|Mensile condiviso
Shared weekly|週次共有枠|共享周限额|Hebdomadaire partagé|Semanal compartido|Settimanale condiviso
Verified|確認済み|已确认|Vérifié|Verificado|Verificato
Counter reset with Codex|Codex 連動で集計を初期化|跟随 Codex 清零计数|Compteur remis à zéro avec Codex|Contador reiniciado con Codex|Contatore azzerato con Codex
Counters restart on observed Codex reset|Codex リセット確認時に集計も初期化|确认 Codex 重置后清零计数|Compteurs remis à zéro au reset Codex observé|Contadores reiniciados al detectar reset de Codex|Contatori azzerati al reset Codex rilevato
Codex reset sync off|Codex リセット連動オフ|Codex 重置同步已关闭|Synchronisation Codex désactivée|Sincronización Codex desactivada|Sincronizzazione Codex disattivata
Other-device history not connected|他の端末の履歴未接続|未连接其他设备记录|Historique des autres appareils non connecté|Historial de otros dispositivos sin conectar|Cronologia di altri dispositivi non collegata
No collected posts|取得した投稿なし|暂无收集帖子|Aucun post collecté|Sin publicaciones recopiladas|Nessun post raccolto
Latest post|最新の投稿|最新帖子|Dernier post|Última publicación|Ultimo post
Shows reset-related posts within the collected range.|取得範囲内のリセット関連投稿のみ表示します。|仅显示收集范围内与重置相关的帖子。|Affiche les posts de reset dans la plage collectée.|Muestra posts sobre resets dentro del rango recopilado.|Mostra post sui reset nell’intervallo raccolto.
Posts/replies|投稿・返信|帖子/回复|Posts/réponses|Posts/respuestas|Post/risposte
Collection failed|取得失敗|收集失败|Échec de collecte|Error de recopilación|Raccolta fallita
Check settings|設定を確認|检查设置|Vérifiez les réglages|Revisa los ajustes|Verifica impostazioni
Waiting|待機中|等待中|En attente|En espera|In attesa
Checking account history…|アカウント履歴を確認中…|正在检查账户记录…|Vérification de l’historique…|Consultando historial…|Verifica cronologia…
Posts|投稿|帖子|Posts|Publicaciones|Post
Replies|返信|回复|Réponses|Respuestas|Risposte
Korea|韓国|韩国|Corée|Corea|Corea
US Pacific|米国太平洋|美国太平洋|Pacifique US|Pacífico EE. UU.|Pacifico USA
Estimated|推定|估计|Estimé|Estimado|Stimato
posted|投稿|发布|publié|publicado|pubblicato
as of|時点|截至|au|a fecha de|al
Monday|月曜日|星期一|lundi|lunes|lunedì
Tuesday|火曜日|星期二|mardi|martes|martedì
Wednesday|水曜日|星期三|mercredi|miércoles|mercoledì
Thursday|木曜日|星期四|jeudi|jueves|giovedì
Friday|金曜日|星期五|vendredi|viernes|venerdì
Saturday|土曜日|星期六|samedi|sábado|sabato
Sunday|日曜日|星期日|dimanche|domingo|domenica
Later today|今日中|今天稍后|Plus tard aujourd’hui|Hoy más tarde|Più tardi oggi
Tomorrow morning|明日の朝|明天早上|Demain matin|Mañana por la mañana|Domattina
Tomorrow|明日|明天|Demain|Mañana|Domani
Next week|来週|下周|Semaine prochaine|La próxima semana|La prossima settimana
This week|今週|本周|Cette semaine|Esta semana|Questa settimana
Tonight|今夜|今晚|Ce soir|Esta noche|Stasera
This evening|今日の夕方|今天傍晚|Ce soir|Esta tarde|Questa sera
Soon|まもなく|即将|Bientôt|Pronto|A breve
AM|午前|上午|AM|a. m.|AM
PM|午後|下午|PM|p. m.|PM
reset|リセット|重置|reset|reset|reset
Off|オフ|关闭|Désactivé|Desactivado|Disattivo`;
  const details=`Customize your display and notifications.|表示と通知を設定できます。|自定义显示和通知。|Personnalisez l’affichage et les notifications.|Personaliza la pantalla y las notificaciones.|Personalizza visualizzazione e notifiche.
Applies to the popup and settings. Saved automatically.|ポップアップと設定に適用され、自動保存されます。|应用于弹窗和设置，并自动保存。|S’applique à la fenêtre et aux réglages. Enregistrement automatique.|Se aplica al panel y los ajustes. Se guarda automáticamente.|Si applica al pannello e alle impostazioni. Salvataggio automatico.
Settings|設定|设置|Réglages|Ajustes|Impostazioni
Detection limits|検出方法と制限|检测方式与限制|Limites de détection|Límites de detección|Limiti di rilevamento
Checking…|確認中…|正在检查…|Vérification…|Comprobando…|Verifica…
Checked.|確認しました。|检查完成。|Vérifié.|Revisado.|Verificato.
Not checked|未確認|尚未检查|Non vérifié|Sin revisar|Non verificato
Test notification|通知をテスト|测试通知|Tester une notification|Probar notificación|Prova notifica
Uses public posts by Tibo and VB as reset signals.|Tibo と VB の公開投稿をリセット予告の情報源とします。|使用 Tibo 和 VB 的公开帖子作为重置信号。|Utilise les posts publics de Tibo et VB comme signaux de reset.|Usa publicaciones públicas de Tibo y VB como señales de reset.|Usa i post pubblici di Tibo e VB come segnali di reset.
Preparing the notification test. If this stays visible, reload this settings tab with F5.|通知テストの準備中です。表示が続く場合は F5 で設定タブを再読み込みしてください。|正在准备通知测试。若一直显示此消息，请按 F5 刷新设置页。|Préparation du test. Si ce message persiste, rechargez cet onglet avec F5.|Preparando la prueba. Si este mensaje persiste, recarga esta pestaña con F5.|Preparazione del test. Se il messaggio persiste, ricarica questa scheda con F5.
No response from the worker. Reload the extension and this tab.|実行コードが応答しません。拡張機能とこのタブを再読み込みしてください。|后台无响应。请重新加载扩展和此标签页。|Aucune réponse du service. Rechargez l’extension et cet onglet.|Sin respuesta del proceso. Recarga la extensión y esta pestaña.|Nessuna risposta dal processo. Ricarica estensione e scheda.
Reload the extension at chrome://extensions/, then press F5 in this settings tab.|chrome://extensions/ で拡張機能を再読み込みし、この設定タブで F5 を押してください。|请在 chrome://extensions/ 重新加载扩展，然后在此设置页按 F5。|Rechargez l’extension via chrome://extensions/, puis cet onglet avec F5.|Recarga la extensión en chrome://extensions/ y esta pestaña con F5.|Ricarica l’estensione da chrome://extensions/, poi questa scheda con F5.
Checks posts and replies from Tibo and VB separately, expanding long posts. Up to 12 scrolls per timeline, 160 unique posts and 3 conversations per check. Opens temporary background tabs for up to 180 seconds; X sign-in in this Chrome may be required. Only public text, dates, links and preceding public conversation are kept locally. No DMs, cookies or credentials are read. Targets the last 7 days; coverage is not guaranteed.|Tibo と VB の投稿・返信を個別に確認し、長文を展開します。各一覧で最大12回スクロール、合計160投稿と3会話を確認します。最長180秒の一時バックグラウンドタブを開きます。この Chrome で X ログインが必要な場合があります。公開本文・時刻・リンク・先行会話のみ端末に保存し、DM・Cookie・認証情報は読みません。過去7日が対象ですが全件取得は保証しません。|分别检查 Tibo 和 VB 的帖子与回复，并展开长文。每个列表最多滚动12次，每次最多读取160条去重帖子及3个对话。临时后台标签页最多打开180秒，可能需要在此 Chrome 中登录 X。仅在本地保存公开文本、时间、链接和前文，不读取私信、Cookie 或凭据。目标范围为最近7天，无法保证完整收集。|Vérifie séparément les posts et réponses de Tibo et VB et développe les textes longs. Maximum : 12 défilements par liste, 160 posts uniques et 3 conversations. Ouvre des onglets temporaires en arrière-plan pendant 180 secondes au plus. Une connexion X dans ce Chrome peut être nécessaire. Seuls les textes, dates, liens et échanges publics précédents sont conservés localement. Aucun message privé, cookie ou identifiant n’est lu. Vise les 7 derniers jours sans garantir une couverture complète.|Revisa por separado posts y respuestas de Tibo y VB y expande textos largos. Máximo: 12 desplazamientos por lista, 160 posts únicos y 3 conversaciones. Abre pestañas temporales en segundo plano hasta 180 segundos; puede requerir iniciar sesión en X en este Chrome. Solo guarda localmente texto, fechas, enlaces y contexto previo públicos. No lee mensajes privados, cookies ni credenciales. Busca los últimos 7 días sin garantizar cobertura completa.|Controlla separatamente post e risposte di Tibo e VB, espandendo i testi lunghi. Massimo: 12 scorrimenti per elenco, 160 post unici e 3 conversazioni. Apre schede temporanee in background per massimo 180 secondi; può richiedere l’accesso a X in questo Chrome. Conserva localmente solo testo, date, link e contesto precedente pubblici. Non legge messaggi privati, cookie o credenziali. Copre gli ultimi 7 giorni senza garantire completezza.
Checks the ChatGPT account and subscription in this Chrome. Counts observed Astra and Sol Pro responses separately per account. Enable account history sync below to include other devices. Remaining messages are estimates. Disabling deletes all local Chat counts.|この Chrome の ChatGPT アカウントと契約を確認し、観測した Astra・Sol Pro の応答をアカウント別に集計します。他の端末分は下の履歴同期を有効にしてください。残数は推定です。無効にするとローカルの Chat 集計をすべて削除します。|检查此 Chrome 的 ChatGPT 账户与订阅，按账户分别统计观测到的 Astra 和 Sol Pro 回复。启用下方记录同步后可纳入其他设备。剩余次数为估算。关闭将删除所有本地 Chat 计数。|Vérifie le compte et l’abonnement ChatGPT de ce Chrome. Compte les réponses Astra et Sol Pro observées par compte. Activez la synchronisation ci-dessous pour inclure les autres appareils. Le solde est estimé. Désactiver supprime tous les compteurs Chat locaux.|Comprueba la cuenta y suscripción de ChatGPT en este Chrome. Cuenta respuestas observadas de Astra y Sol Pro por cuenta. Activa la sincronización inferior para incluir otros dispositivos. El saldo es estimado. Desactivar borra todos los recuentos locales de Chat.|Verifica account e abbonamento ChatGPT in questo Chrome. Conta le risposte osservate di Astra e Sol Pro per account. Attiva la sincronizzazione sotto per includere altri dispositivi. Il residuo è stimato. Disattivando si eliminano tutti i conteggi Chat locali.
Enable to read the last 30 days of synced account history. Responses may contain conversation text, but text is not stored, logged or sent elsewhere. Only model, timestamp and a deduplication hash are counted. Deleted and temporary chats may be missing. Checks up to 20 conversations per run, then continues next time. Disabling removes imported counts and sync records.|有効にすると同期済みの過去30日の履歴を確認します。応答に会話本文が含まれる場合がありますが、保存・ログ出力・外部転送はしません。モデル・利用時刻・重複除外用ハッシュだけを集計します。削除済み・一時チャットは含まれない場合があります。1回20会話まで確認し次回に続きます。無効にすると取得済み集計と同期記録を削除します。|启用后读取最近30天已同步的账户记录。响应可能包含对话正文，但不会保存、记录或向外发送正文，仅统计模型、时间和去重哈希。删除或临时聊天可能缺失。每次最多检查20个对话，下次继续。关闭会删除导入的计数和同步记录。|Lit les 30 derniers jours de l’historique synchronisé. Les réponses peuvent contenir du texte, qui n’est ni conservé, ni journalisé, ni transmis ailleurs. Seuls le modèle, l’heure et un hash de dédoublonnage sont comptés. Les chats supprimés ou temporaires peuvent manquer. Vérifie 20 conversations au plus par passage, puis reprend au suivant. Désactiver efface les compteurs importés et les traces de synchronisation.|Lee los últimos 30 días del historial sincronizado. Las respuestas pueden incluir texto, pero no se guarda, registra ni envía a otro lugar. Solo cuenta modelo, hora y hash de deduplicación. Pueden faltar chats eliminados o temporales. Revisa hasta 20 conversaciones por ejecución y continúa después. Desactivar elimina recuentos importados y registros de sincronización.|Legge gli ultimi 30 giorni della cronologia sincronizzata. Le risposte possono contenere testo, che non viene salvato, registrato o inviato altrove. Conta solo modello, ora e hash di deduplicazione. Chat eliminate o temporanee possono mancare. Controlla fino a 20 conversazioni per esecuzione e riprende alla successiva. Disattivando si eliminano conteggi importati e registri di sincronizzazione.
When account quota and Chat counting are enabled, observed 5-hour or weekly quota recovery starts a new local Astra/Sol Pro count. Includes recovery observed after restarting your PC. This does not verify a Chat server quota reset; remaining messages are estimates.|利用枠確認と Chat 集計が有効な場合、5時間・週間枠の回復を観測するとローカルの Astra・Sol Pro 集計を初期化します。PC 再起動後に確認した回復も含みます。Chat サーバーの上限リセットを確認する機能ではなく、残数は推定です。|启用账户额度查询和 Chat 计数时，观测到5小时或每周额度恢复会重新开始本地 Astra/Sol Pro 计数，包括重启电脑后发现的恢复。这不验证 Chat 服务器的额度重置，剩余次数仍为估算。|Si le quota et le comptage Chat sont activés, une récupération du quota sur 5 heures ou hebdomadaire remet à zéro le compteur local Astra/Sol Pro, y compris après un redémarrage du PC. Cela ne vérifie pas un reset côté serveur Chat ; le solde reste estimé.|Si se activan cuota y recuento Chat, la recuperación observada de la cuota de 5 horas o semanal reinicia el contador local de Astra/Sol Pro, también tras reiniciar el PC. No verifica un reset del servidor Chat; el saldo sigue siendo estimado.|Con quota e conteggio Chat attivi, un recupero osservato della quota di 5 ore o settimanale riavvia il conteggio locale Astra/Sol Pro, anche dopo il riavvio del PC. Non verifica un reset sul server Chat; il residuo resta stimato.
Notifies when 5-hour or weekly quota returns to 100%, or when its reset window changes and remaining quota increases. The first reading is saved as a baseline.|5時間・週間枠が100%に回復、またはリセット期間が切り替わり残枠が増えたとき通知します。初回値は比較基準として保存します。|当5小时或每周额度恢复到100%，或重置周期变化且剩余额度增加时通知。首次读取作为基准保存。|Alerte si le quota de 5 heures ou hebdomadaire revient à 100 %, ou si sa fenêtre change et que le solde augmente. Le premier relevé sert de référence.|Avisa cuando la cuota de 5 horas o semanal vuelve al 100 %, o cambia su ventana y aumenta el saldo. La primera lectura se guarda como referencia.|Avvisa quando la quota di 5 ore o settimanale torna al 100%, oppure cambia la finestra e aumenta il residuo. La prima lettura è il riferimento.
After Chrome starts or a long gap, notifies about recovery on the same account, even during the extension’s quiet hours. Keeps comparison records for up to 30 days and retries network failures. Chrome must be running; Windows notification settings apply.|Chrome 起動後や長い中断後に、同じアカウントの回復を拡張機能のおやすみ時間中でも通知します。比較記録は最大30日保管し、通信失敗は再試行します。Chrome の起動が必要で、Windows の通知設定が適用されます。|Chrome 启动或长时间中断后，即使处于扩展勿扰时段，也会通知同一账户的额度恢复。比较记录最多保留30天，网络失败会重试。Chrome 必须运行，并受 Windows 通知设置控制。|Après le démarrage de Chrome ou une longue interruption, signale la récupération du même compte, même pendant les heures silencieuses de l’extension. Conserve les références 30 jours au plus et réessaie les échecs réseau. Chrome doit fonctionner ; les réglages Windows s’appliquent.|Al iniciar Chrome o tras una pausa larga, avisa de la recuperación de la misma cuenta incluso en el horario silencioso de la extensión. Conserva referencias hasta 30 días y reintenta errores de red. Chrome debe estar abierto; se aplican los ajustes de Windows.|All’avvio di Chrome o dopo una lunga pausa, segnala il recupero dello stesso account anche nell’orario silenzioso dell’estensione. Conserva i riferimenti fino a 30 giorni e riprova gli errori di rete. Chrome deve essere in esecuzione; valgono le impostazioni Windows.
On return, notifies once about missed announcements or hints if those alerts are enabled. Bypasses extension quiet hours. Covers up to 3 hints from the last 7 days, including late collection. Hints are unconfirmed and remain visible even with hint notifications off.|復帰時、対象通知が有効なら見逃した予告・候補を1回通知します。拡張機能のおやすみ時間を除外し、取得が遅れたものを含め過去7日の候補を最大3件確認します。候補は未確定で、候補通知が無効でも画面には表示します。|恢复后，若对应通知已开启，会补发一次错过的预告或线索，并绕过扩展勿扰时段。覆盖最近7天最多3条线索，包括延迟收集的内容。线索未获确认，即使关闭线索通知也会保留显示。|Au retour, signale une fois les annonces ou indices manqués si leurs alertes sont activées, sans tenir compte des heures silencieuses. Couvre au plus 3 indices des 7 derniers jours, même collectés tardivement. Les indices ne sont pas confirmés et restent visibles si leurs alertes sont désactivées.|Al volver, avisa una vez de anuncios o indicios pendientes si sus alertas están activadas, omitiendo el horario silencioso. Incluye hasta 3 indicios de los últimos 7 días, incluso recopilados tarde. No están confirmados y siguen visibles con sus avisos desactivados.|Al ritorno, avvisa una volta degli annunci o indizi persi se i relativi avvisi sono attivi, ignorando l’orario silenzioso. Copre fino a 3 indizi degli ultimi 7 giorni, anche raccolti in ritardo. Non sono confermati e restano visibili con i relativi avvisi disattivati.
Optional alerts for metaphors, reset-related replies and launch-time clues. These do not confirm a release or reset. Off by default. Enabling may notify once about hints from the last 7 days. New metaphors, images and unclear context may be missed.|比喩・リセット関連の返信・公開時刻の手がかりに任意で通知します。公開やリセットの確定ではありません。初期状態はオフです。有効にすると過去7日の候補を1回通知する場合があります。新しい比喩・画像・曖昧な文脈は見逃す可能性があります。|可选通知隐喻、重置相关回复和发布时间线索。这些不代表发布或重置已确认。默认关闭。开启后可能对最近7天的线索通知一次。新的隐喻、图片或模糊语境可能被漏检。|Alertes facultatives pour les métaphores, réponses sur les resets et indices de lancement. Elles ne confirment aucun lancement ni reset. Désactivées par défaut. L’activation peut notifier une fois les indices des 7 derniers jours. Nouvelles métaphores, images et contextes ambigus peuvent être manqués.|Avisos opcionales de metáforas, respuestas sobre resets e indicios de lanzamiento. No confirman lanzamiento ni reset. Desactivados por defecto. Al activarlos pueden avisar una vez de indicios de los últimos 7 días. Pueden omitirse metáforas nuevas, imágenes o contextos ambiguos.|Avvisi facoltativi su metafore, risposte relative ai reset e indizi di lancio. Non confermano lanci o reset. Disattivati inizialmente. L’attivazione può notificare una volta gli indizi degli ultimi 7 giorni. Nuove metafore, immagini e contesti ambigui possono sfuggire.
Notifies once about qualifying announcements, completed resets and banked reset grants from monitored authors. Your own quota recovery is checked separately.|監視対象の予告・リセット完了・banked reset 付与を条件に合う場合1回通知します。自分の利用枠回復は別途確認します。|对监测作者符合条件的预告、重置完成和 banked reset 发放各通知一次。个人额度恢复单独检查。|Signale une fois les annonces admissibles, resets terminés et crédits banked reset des auteurs suivis. Votre propre récupération de quota est vérifiée séparément.|Avisa una vez de anuncios válidos, resets completados y créditos banked reset de los autores seguidos. Tu recuperación de cuota se comprueba por separado.|Avvisa una volta per annunci validi, reset completati e crediti banked reset degli autori seguiti. Il recupero della tua quota è verificato separatamente.
Notifies about postponements linked to an earlier announcement. Hint changes require hint alerts; explicit announcements require reset alerts. Inferred links are labeled when direct reply references are absent.|以前の予告に関連する延期を通知します。候補の変更には候補通知、直接の予告にはリセット通知が必要です。返信の直接参照がない関連付けには推定と表示します。|通知与之前预告关联的延期。线索变更需要开启线索通知，明确预告需要开启重置通知。没有直接回复关系时，会标明关联为推断。|Signale les reports liés à une annonce précédente. Les changements d’indices nécessitent leurs alertes, les annonces explicites celles des resets. Les liens déduits sont indiqués si aucune référence directe de réponse n’existe.|Avisa de aplazamientos vinculados a un anuncio anterior. Los cambios de indicios requieren sus avisos; los anuncios explícitos requieren avisos de reset. Se indica si la relación es inferida sin una referencia directa de respuesta.|Segnala rinvii collegati a un annuncio precedente. I cambi di indizi richiedono i relativi avvisi; gli annunci espliciti richiedono avvisi reset. I collegamenti dedotti sono segnalati in assenza di riferimenti diretti di risposta.
Public feeds require no sign-in. Optional direct X reading may require X sign-in. Account quota is read only when enabled; disabling removes account data.|公開フィードはログイン不要です。任意の X 直接確認には X ログインが必要な場合があります。アカウントの利用枠は有効時のみ読み取り、無効にするとアカウントデータを削除します。|公开信息源无需登录。可选的 X 直接读取可能需要登录 X。仅在启用时读取账户额度，关闭会删除账户数据。|Les flux publics ne nécessitent pas de connexion. La lecture directe X facultative peut en demander une. Le quota n’est lu que si activé ; désactiver supprime les données du compte.|Las fuentes públicas no requieren iniciar sesión. La lectura directa opcional de X puede requerirlo. La cuota solo se lee al activarla; desactivar elimina los datos de cuenta.|I flussi pubblici non richiedono accesso. La lettura diretta facoltativa di X può richiederlo. La quota viene letta solo se attiva; disattivando si eliminano i dati dell’account.`;
  const catalogs=Object.fromEntries(languages.map(language=>[language,{}]));
  const chatRows=`Chat · Model usage|Chat・モデル別使用量|Chat · 模型使用量|Chat · Usage par modèle|Chat · Uso por modelo|Chat · Uso per modello
Standard Sol|通常の Sol|普通 Sol|Sol standard|Sol estándar|Sol standard
Workspace-specific limits|ワークスペース別の上限|工作区特定限额|Limites de l’espace de travail|Límites del espacio de trabajo|Limiti dell’area di lavoro
No fixed remaining count published|固定の残り回数は非公開|未公布固定剩余次数|Nombre restant fixe non publié|Sin número restante fijo publicado|Numero residuo fisso non pubblicato
Checking quota, news, plan and history…|利用枠・情報・プラン・履歴を確認中…|正在检查额度、消息、套餐和记录…|Vérification du quota, des actualités, du forfait et de l’historique…|Comprobando cuota, novedades, plan e historial…|Verifica quota, novità, piano e cronologia…
Checking plan…|プランを確認中…|正在检查套餐…|Vérification du forfait…|Comprobando el plan…|Verifica del piano…
Plan page did not load · Reconnect to check your plan|プラン画面を読み込めません・再接続してください|套餐页面未加载 · 请重新连接|Page du forfait non chargée · Reconnectez-vous|No se cargó el plan · Vuelve a conectar|Piano non caricato · Riconnettiti
The plan check did not complete.|プランの確認が完了しませんでした。|未能完成套餐检查。|La vérification du forfait n’a pas abouti.|No se completó la comprobación del plan.|La verifica del piano non è stata completata.
Please retry Chat history sync.|Chat 履歴の同期を再試行してください。|请重试 Chat 记录同步。|Réessayez la synchronisation de l’historique Chat.|Vuelve a sincronizar el historial de Chat.|Riprova la sincronizzazione della cronologia Chat.
Optional · Local count since Codex reset|任意・Codex リセット後のローカル集計|可选 · Codex 重置后的本地统计|Facultatif · Compte local depuis le reset Codex|Opcional · Conteo local desde el reset Codex|Facoltativo · Conteggio locale dal reset Codex`;
  const chatHelp=`Checks the account plan and separates Astra, Sol Pro, standard Sol and Luna usage. Enable history sync below to include other devices. Check now refreshes both plan and history. Remaining counts are estimates. Disabling deletes all Chat counts.|プランと Astra・Sol Pro・通常の Sol・Luna の使用を分けて集計します。他の端末は下の履歴同期を有効にしてください。「今すぐ確認」でプランと履歴を更新します。残数は推定です。無効にすると Chat 集計を削除します。|检查账户套餐并分别统计 Astra、Sol Pro、普通 Sol 和 Luna。开启下方记录同步可包含其他设备。「立即检查」同时更新套餐与记录。剩余量为估算；关闭会删除所有 Chat 计数。|Vérifie le forfait et distingue Astra, Sol Pro, Sol standard et Luna. Activez la synchronisation pour inclure les autres appareils. Vérifier maintenant actualise le forfait et l’historique. Le solde est estimé. Désactiver supprime les compteurs Chat.|Comprueba el plan y separa Astra, Sol Pro, Sol estándar y Luna. Activa la sincronización para incluir otros dispositivos. Comprobar ahora actualiza plan e historial. El saldo es estimado. Desactivar borra los recuentos Chat.|Verifica il piano e distingue Astra, Sol Pro, Sol standard e Luna. Attiva la sincronizzazione per includere altri dispositivi. Controlla ora aggiorna piano e cronologia. Il residuo è stimato. Disattivando si eliminano i conteggi Chat.
Chat and Codex have separate allowances. Off by default. Enabling excludes records before the Codex recovery time from local counts. Do not use it as the actual remaining Chat allowance.|Chat と Codex の利用枠は別です。初期設定はオフです。有効にすると Codex 回復前の記録をローカル集計から除外します。Chat の実際の残数ではありません。|Chat 和 Codex 的额度独立，默认关闭。开启后从本地统计排除 Codex 恢复前的记录，不能作为 Chat 的实际剩余额度。|Chat et Codex ont des quotas distincts. Désactivé par défaut. L’activer exclut les entrées antérieures à la récupération Codex du compteur local, qui ne représente pas le solde Chat réel.|Chat y Codex tienen cuotas separadas. Desactivado por defecto. Al activarlo, se excluyen registros anteriores a la recuperación de Codex del conteo local. No representa el saldo real de Chat.|Chat e Codex hanno quote separate. Disattivo per impostazione predefinita. Attivandolo si escludono dal conteggio locale i record precedenti al recupero Codex. Non rappresenta il saldo Chat effettivo.`;
  const meterRows="Select allowance basis|利用枠の基準を選択|选择额度基准|Choisir la base du quota|Elegir la base del límite|Scegli la base della quota\nSelect your plan to calculate remaining|残数の計算にはプランを選択|选择套餐以计算剩余量|Choisissez votre forfait pour calculer le solde|Elige tu plan para calcular el saldo|Scegli il piano per calcolare il residuo\nPlan for this account|このアカウントのプラン|此账户的套餐|Forfait de ce compte|Plan de esta cuenta|Piano di questo account\nDetect automatically|自動確認|自动检测|Détection automatique|Detectar automáticamente|Rileva automaticamente\nSelected plan · Change|選択したプラン・変更|所选套餐 · 更改|Forfait choisi · Modifier|Plan elegido · Cambiar|Piano scelto · Modifica\nSelected plan|選択したプラン|所选套餐|Forfait choisi|Plan elegido|Piano scelto\nLast verified plan · Recheck needed|前回のプラン・再確認が必要|上次确认的套餐 · 需重新确认|Dernier forfait vérifié · À revérifier|Último plan verificado · Revisar|Ultimo piano verificato · Ricontrolla\nVerified plan · Change|確認済みプラン・変更|已确认套餐 · 更改|Forfait vérifié · Modifier|Plan verificado · Cambiar|Piano verificato · Modifica\nApplies only to this account. Does not change your subscription.|このアカウントの集計だけに適用され、契約は変更しません。|仅应用于此账户，不更改订阅。|S’applique à ce compte sans modifier l’abonnement.|Se aplica a esta cuenta sin cambiar la suscripción.|Si applica a questo account senza modificare l’abbonamento.\nAutomatic check failed. Select your plan above.|自動確認できません。上でプランを選択してください。|自动检查失败，请在上方选择套餐。|Échec de la vérification. Choisissez votre forfait ci-dessus.|Falló la comprobación. Elige tu plan arriba.|Verifica non riuscita. Scegli il piano sopra.\nCould not save. Check your account and select again.|保存できません。アカウントを確認して再選択してください。|无法保存，请检查账户并重新选择。|Enregistrement impossible. Vérifiez le compte et réessayez.|No se pudo guardar. Revisa la cuenta e inténtalo de nuevo.|Impossibile salvare. Verifica l’account e riprova.\nDaily|日間|每日|Par jour|Diario|Giornaliero\nMonthly|月間|每月|Par mois|Mensual|Mensile\nEstimated Chat remaining|Chat の推定残数|Chat 估算剩余量|Solde Chat estimé|Saldo Chat estimado|Residuo Chat stimato";
  const autoRows="Automatic check failed · Showing the previous basis|自動確認に失敗・前の基準で表示中|自动检查失败 · 正按原基准显示|Échec de la vérification · Base précédente conservée|Falló la verificación · Se mantiene la base anterior|Verifica non riuscita · Base precedente mantenuta\nAutomatic check did not complete. The previous basis is preserved.|自動確認が完了しませんでした。前の基準を維持します。|自动检查未完成，保留原有基准。|La vérification automatique n’a pas abouti. La base précédente est conservée.|No se completó la verificación automática. Se conserva la base anterior.|La verifica automatica non è stata completata. La base precedente è mantenuta.";
  for(const row of (rows+'\n'+details+'\n'+chatRows+'\n'+chatHelp+'\n'+meterRows+'\n'+autoRows).split('\n')){
    const [key,...values]=row.split('|');
    languages.forEach((language,index)=>{catalogs[language][key]=values[index];});
  }
  root.RadarUiLocales=catalogs;
  if(typeof module!=='undefined') module.exports=catalogs;
})(globalThis);
