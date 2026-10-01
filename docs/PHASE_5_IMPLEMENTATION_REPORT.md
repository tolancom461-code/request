# تقرير تنفيذ Phase 5 — تدفق طلبات الفروع التشغيلي

## ملخص الإغلاق

تم تنفيذ **Phase 5 فقط** وفق عقد `P-005_PHASE5_BRANCH_REQUISITION_POS_OPERATIONAL_WORKFLOW_PREPARED.md`. يستطيع مستخدم الفرع المخول اختيار فرع ضمن نطاقه، واستعراض كتالوج صالح للطلب، وإنشاء أو استئناف مسودة خادمية، وإضافة سطور كمية/وحدة، ومراجعة السلة، ثم التقديم أو إعادة التقديم عبر الضوابط المعتمدة. لا توجد Phase 6 أو إنشاء أوامر شراء أو استلام أو مخزون أو حركة مستودع أو تكامل دفع.

| المجال | النتيجة |
|---|---|
| الكتالوج | مصدره TiDB وتهيئة Phase 4 الفعلية؛ لا يعرض المورد أو معلومات الشراء. |
| المسودة والسلة | `RequestRecord` و`RequestItem` القائمان؛ لا جدول أو migration جديد. |
| اللقطة والتقديم | يعيدان استخدام `RequestLinePreparationService` و`RequestSubmissionService` وقاعدة المورد الأساسي الزمنية من P-004-C1. |
| UI | T3 + I1، العربية RTL والإنجليزية LTR والأردية RTL، ومعاملات خادمية حقيقية. |
| Prisma schema/migrations | لم تتغير. |
| Phase 6 | **NOT STARTED**. |

## ما تم تنفيذه فعليًا

أضيفت `RequisitionService` و`RequisitionController` على API القائم. يعرض مسار الكتالوج الفروع الواقعة في نطاق المستخدم فقط، ثم الفئات والعناصر القابلة للطلب فقط: BranchItem وBranch وItem وفئة نشطة، مع وحدة أساس صالحة ومورد أساسي فعّال في التاريخ الحالي. لا تكشف payloads المورد أو التكلفة أو السعر أو بيانات الشراء، وتستخدم أسماء AR/EN/UR وحالة الصورة من كائن الصورة القائم دون إظهار object key.

| المسار التشغيلي | السلوك |
|---|---|
| `GET /api/v1/requisition/branches` | فروع المستخدم المسموح بها فقط. |
| `GET /api/v1/requisition/branches/:branchId/categories` | فئات تحتوي عنصرًا قابلًا للطلب ضمن الفرع والتاريخ الحالي. |
| `GET /api/v1/requisition/branches/:branchId/categories/:categoryId/items` | كتالوج مفلتر/مفهرس ومقسم صفحات، بلا معلومات المورد. |
| `POST /api/v1/requisitions` | ينشئ مسودة مرقمة خادميًا أو يستأنف مسودة الفرع القائمة للمالك نفسه. |
| `POST /api/v1/requisitions/:id/items` | upsert لسطر نشط واحد لكل BranchItem مع وحدة كمية مقفلة/متحقق منها. |
| `DELETE /api/v1/requisitions/:id/items/:lineId` | إلغاء منطقي للسطر مع row-version. |
| `POST /api/v1/requisitions/:id/submit` | يعيد التحقق من كامل المسودة ويلتقط snapshots ثم يقدم atomically. |
| `POST /api/v1/requisitions/:id/resubmit` | يدعم مسار `returned` المعتمد، مع إعادة تحقق/لقطة وتاريخ حالة/audit. |
| `GET /api/v1/requisitions` و`/:id` | سجل المستخدم وقراءة المالك/النطاق فقط. |

تعالج الخدمة مسودات الفرع ضمن transaction، وتعيد محاولة رقم الطلب عند تعارض uniqueness، وتحمي التعديل بـ`expectedRowVersion`. تمنع الخدمة أكثر من active line للعنصر نفسه ضمن السلة، وتعيد استخدام وحدة السطر ولقطة المورد الزمنية عند التقديم. تمت المحافظة على audit events وتاريخ الحالة كما في أساس المشروع، ولا تتحول لوحة العميل إلى حد أمني: يتطلب الخادم `request.submit` للمسار التشغيلي وCSRF لكل كتابة ونطاق الفرع والمالك لكل request.

## واجهة طلب الفرع

تتضمن الواجهة اختيار الفرع والفئة وبطاقات كتالوج مناسبة للمس، وحوار كمية ووحدة يجلب وحدات العنصر الفعالة من الخادم، وسلة بعلامة عدد الأسطر، وحوار مراجعة/تأكيد، وتاريخ طلباتي. لا يمكن للواجهة تخمين وحدة أو مورد أو طلب منتهي/مستقبلي؛ القرار النهائي يظل في API. تعرض الحالات loading وempty وerror وoffline برسائل صادقة؛ لا تُخزن عمليات أو مسودات أعمال محليًا أثناء عدم الاتصال.

تم إصلاح حد تطوير محلي فقط في CSRF: يقبل السيرفر في development أصلَي `localhost:3000` و`localhost:5173` الصريحين كي تعمل واجهة Vite، بينما يظل الإنتاج محصورًا بالأصل الإنتاجي المهيأ. يحمي الاختبار الجديد عدم توسيع قائمة production.

## التحقق المنفذ

| الفحص | النتيجة | الدليل |
|---|---|---|
| تكامل Phase 5 | PASS — 4 اختبارات TiDB | `evidence/phase5/full_regression.log` |
| واجهة Phase 5 | PASS — 3 اختبارات عقد | `evidence/phase5/phase5_ui_contract.log` |
| أصل CSRF | PASS — اختباران | `evidence/phase5/full_regression.log` |
| الانحدار الكامل | PASS — **17 ملفًا / 62 اختبارًا** | `evidence/phase5/full_regression.log` |
| Prisma validate/generate وTypeScript | PASS | `evidence/phase5/final_check_build_prisma.log` |
| build وPWA | PASS — 64 precache entries | نفس السجل. |
| تدقيق schema/migrations والنطاق | PASS | `evidence/phase5/final_scope_audit.log` |
| الفحص المرئي | PASS | `phase5/visual_verification_notes.md` واللقطات. |

يشمل اختبار التكامل فروعًا خارج نطاق المستخدم، ورفض الصلاحية وCSRF، وكتالوج requestable فعلي، وعدم إفشاء المورد، وإنشاء/استئناف المسودة، وupsert السطر، ورفض الوحدة غير الفعالة، والحذف، وتزامن السلة والتقديم، وإعادة تقديم returned مع تحديث اللقطة. تم حذف حساب وفروع وعناصر ووحدات وموردين وطلبات التحقق المؤقتة بعد الالتقاط والفحص.

## القيود والبيانات التمثيلية

لم يبق بند Phase 5 مفقود داخل المصدر أو الاختبارات. اللقطات تعرض سجل تحقق مؤقتًا برمز `P5V-*` ومسودة مرقمة؛ لا تمثل طلبًا حقيقيًا أو بيانات مطعم تشغيلية، وقد حذفت كامل علاقاته بعد الالتقاط. لا تحتوي الواجهة على أسعار أو مخزون أو موردين أو مراجعات أو تقييمات أو عمليات شراء مصطنعة.

ينتج build تحذير chunk للواجهة يقترب من 1.02 MB وتحذير `baseline-browser-mapping` غير حاجبين؛ لا يفشلان build أو PWA. يمكن معالجة code splitting في مرحلة مفوضة مستقلة، وليس ضمن Phase 5.

## سطور الإغلاق

PHASE 5 BRANCH REQUISITION WORKFLOW COMPLETE: YES

SERVER-BACKED DRAFT AND CART: YES

DATE-AWARE SUPPLIER SNAPSHOT ON SUBMIT: YES

PRISMA SCHEMA CHANGED IN PHASE 5: NO

PRISMA MIGRATIONS CHANGED IN PHASE 5: NO

PHASE 6 STARTED: NO

SAFE SOURCE AND EVIDENCE PACKAGE PREPARED: YES

## حزمة المصدر والأدلة الآمنة

تم إنشاء `Restaurant_Branch_Requisition_Phase_5_Branch_Requisition_Operational_Workflow_Package.zip` من 199 ملفًا من المصدر والتقارير والتوثيق والأدلة اللازمة. اجتازت الحزمة فحص الأسرار و`unzip -t`، وتوجد بصمتها في ملف SHA-256 الجانبي. استُبعد دليل `evidence/` الخام التاريخي لأنه يحتوي مخرجات Phase 2A القديمة التي تسجل عناوين TiDB؛ نُقلت أدلة Phase 5 النهائية المنقحة فقط إلى `evidence/phase5/` داخل الحزمة.

تطابقات الاتصال الوحيدة المسموح بها هي fixtures غير قابلة للتوجيه إلى `db.example` في اختبارات config/storage. لا تحتوي النسخة على DSN فعلي أو كلمة مرور أو مفتاح S3 أو ملف بيئة أو `.project-config.json`.
