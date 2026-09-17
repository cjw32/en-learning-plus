import io
import json
import subprocess
from unittest.mock import patch
from test_server import PublisherFixture, EXAMPLE, p


class EditTests(PublisherFixture):
    def test_taxonomy_only_edit_preview_normalizes_and_preserves_content(self):
        article,payload,_,_=self.prepare()
        head=self.remote('rev-parse','main')
        preview=p.prepare_edit({**payload,'message_id':'om_taxonomy','body':article['body'],
                                'category':' Astro 学习 ', 'tags':['AI',' #astro ','astro','C#']})
        self.assertEqual(preview['category'],'Astro 学习')
        self.assertEqual(preview['tags'],['AI','astro','C#'])
        self.assertEqual(self.remote('rev-parse','main'),head)
        p.confirm_edit({'draft_id':preview['draft_id'],'confirmation_message_id':'om_save_taxonomy','confirmation_text':'上传吧'})
        after=p.read_article(article['id'])
        for key in ['title','summary','body','date','url']:
            self.assertEqual(after[key],article[key],key)
        self.assertEqual(after['category'],preview['category'])
        self.assertEqual(after['tags'],preview['tags'])
        self.assertTrue(after['updated_at'])
        self.assertEqual(p.list_articles('astro')['total'],1)

    def test_clear_tags_and_category_only_preserve_omitted_metadata(self):
        article,payload,_,_=self.prepare()
        for n,extra in enumerate([{'tags':[]},{'category':'全新分类'}]):
            article=p.read_article(article['id'])
            preview=p.prepare_edit({**payload,'expected_sha256':article['sha256'],
                                    'message_id':'om_meta_'+str(n),'body':article['body'],**extra})
            p.confirm_edit({'draft_id':preview['draft_id'],'confirmation_message_id':'om_meta_ok_'+str(n),'confirmation_text':'可以了'})
            after=p.read_article(article['id'])
            self.assertEqual(after['tags'],[])
            self.assertEqual(after['category'],extra.get('category',article['category']))
            self.assertEqual(after['body'],article['body'])

    def test_taxonomy_limits_noop_and_revision_binding(self):
        article,payload,_,_=self.prepare()
        head=self.remote('rev-parse','main')
        for change in [{'category':''},{'category':[]},{'category':'a,b'},{'category':'a\nb'},
                       {'category':'x'*51},{'tags':'astro'},{'tags':['#']},{'tags':[1]},
                       {'tags':['x']*13},{'tags':['x'*41]},{'tags':['a\nb']},
                       {'tags':['sk-'+'x'*32]}]:
            with self.subTest(change=change),self.assertRaises(ValueError):
                p.prepare_edit({**payload,'message_id':'om_bad',**change})
        values={**payload,'message_id':'om_meta_draft','body':article['body'],
                'category':article['category'],'tags':article['tags']}
        preview=p.prepare_edit(values)
        confirm={'draft_id':preview['draft_id'],'confirmation_message_id':'om_meta_ok','confirmation_text':'可以了'}
        with self.assertRaisesRegex(ValueError,'No content changes'):
            p.confirm_edit(confirm)
        with self.assertRaisesRegex(ValueError,'another draft'):
            p.prepare_edit({**values,'tags':['astro']})
        new=p.prepare_edit({**values,'message_id':'om_new','tags':['astro']})
        with self.assertRaisesRegex(ValueError,'newer draft'):
            p.confirm_edit(confirm)
        self.assertEqual(self.remote('rev-parse','main'),head)
        p.confirm_edit({**confirm,'draft_id':new['draft_id']})
        self.assertEqual(p.read_article(article['id'])['tags'],['astro'])

    def test_legacy_taxonomy_formats_and_safe_field_replacement(self):
        for raw in ['tags: ["astro", "C#"]','tags: astro, C#',"tags:\n  - 'astro'\n  - C#",'tags:\n- astro\n- C#']:
            header='category: "技术文章"\n'+raw+'\ncustom:\n  nested: keep'
            self.assertEqual(p.article_taxonomy(header),{'category':'技术文章','tags':['astro','C#']})
            changed=p.set_header_value(header,'tags',['新标签'])
            self.assertEqual(p.article_taxonomy(changed)['tags'],['新标签'])
            self.assertIn('custom:\n  nested: keep',changed)
            self.assertNotIn('- C#',changed)
        self.assertEqual(p.article_taxonomy(''),{'category':'其他','tags':[]})
        for raw in ['tags: [unquoted, flow]', 'tags: {a: b}', 'tags: [1]', 'tags: []\ntags: []']:
            with self.assertRaises(ValueError): p.article_taxonomy(raw)

    def test_pin_unpin_and_priority_only_preserve_article_content(self):
        article,payload,_,_=self.prepare()
        self.assertEqual(article['index'],0)
        for i,priority in enumerate([1,10,0]):
            before=p.read_article(article['id'])
            preview=p.prepare_edit({**payload,'body':before['body'],'expected_sha256':before['sha256'],
                                    'message_id':'om_pin_'+str(i),'index':priority})
            self.assertEqual(preview['index'],priority)
            self.assertEqual(p.read_article(article['id'])['sha256'],before['sha256'])
            p.confirm_edit({'draft_id':preview['draft_id'],'confirmation_message_id':'om_pin_ok_'+str(i),'confirmation_text':'可以了'})
            after=p.read_article(article['id'])
            for key in ['body','title','summary','category','tags','date','url']:
                self.assertEqual(after[key],before[key],key)
            self.assertEqual(after['index'],priority)
            self.assertTrue(after['updated_at'])
            self.assertEqual(p.list_articles(article['id'])['articles'][0]['index'],priority)

    def test_invalid_pin_priority_and_unseen_changes_are_rejected(self):
        article,payload,_,_=self.prepare()
        for value in [-1,1.5,True,'1',None,10001]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                p.prepare_edit({**payload,'message_id':'om_bad_pin','index':value})
        values={**payload,'message_id':'om_pin','index':5}
        preview=p.prepare_edit(values)
        with self.assertRaisesRegex(ValueError,'another draft'):
            p.prepare_edit({**values,'index':10})
        confirmation={'draft_id':preview['draft_id'],'confirmation_message_id':'om_approve','confirmation_text':'可以了'}
        with self.assertRaises(ValueError):p.confirm_edit({**confirmation,'index':10})
        p.confirm_edit(confirmation)
        self.assertEqual(p.read_article(article['id'])['index'],5)

    def change(self, path, source):
        head=p.fetch_head(); env={'GIT_INDEX_FILE':str(self.root/'test-index')}
        blob=p.git('hash-object','-w','--stdin',input=source).stdout.decode().strip()
        p.git('read-tree',head,extra_env=env)
        p.git('update-index','--add','--cacheinfo','100644,'+blob+','+path,extra_env=env)
        tree=p.git('write-tree',extra_env=env).stdout.decode().strip()
        commit=p.git('commit-tree',tree,'-p',head,input=b'external change\n').stdout.decode().strip()
        p.git('push','origin',commit+':refs/heads/main')

    def prepare(self):
        job=p.publish(EXAMPLE); article=p.read_article(job['id'])
        payload={'article_id':article['id'],'expected_sha256':article['sha256'],'message_id':'om_edit_1',
                 'title':article['title'],'summary':article['summary'],'body':article['body']+'\n新增的内容。\n'}
        preview=p.prepare_edit(payload)
        confirmation={'draft_id':preview['draft_id'],'confirmation_message_id':'om_approve','confirmation_text':'可以了，上传吧'}
        return article,payload,preview,confirmation

    def test_read_and_revisions_only_stage_until_confirmed(self):
        article,payload,first,confirmation=self.prepare()
        self.assertEqual(article['body'], '\n'+EXAMPLE['body']+'\n')
        head=self.remote('rev-parse','main')
        second=p.prepare_edit({**payload,'message_id':'om_edit_2','body':payload['body']+'第二轮修改\n'})
        self.assertEqual(second['body'],payload['body']+'第二轮修改\n')
        self.assertEqual(self.remote('rev-parse','main'),head)
        self.assertEqual(p.read_article(article['id'])['body'],article['body'])
        with self.assertRaisesRegex(ValueError,'newer draft'):
            p.confirm_edit(confirmation)
        self.assertEqual(self.remote('rev-parse','main'),head)
        saved=p.confirm_edit({**confirmation,'draft_id':second['draft_id']})
        self.assertEqual(p.read_article(article['id'])['body'],second['body'])
        self.assertEqual(saved['article_id'],article['id'])

    def test_update_preserves_url_original_metadata_and_concurrent_files(self):
        article,payload,preview,confirmation=self.prepare()
        pth='public/markdown/'+article['id']+'.md'
        self.change('another-file.txt',b'concurrent change')
        before=self.remote('rev-parse','main').decode().strip()
        saved=p.confirm_edit(confirmation)
        updated=p.read_article(article['id'])
        self.assertEqual(updated['date'],EXAMPLE['date'])
        self.assertEqual(updated['url'],article['url'])
        self.assertEqual(updated['body'],preview['body'])
        self.assertRegex(updated['updated_at'],r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$')
        self.assertEqual(saved['previous_commit'],before)
        self.assertEqual(self.remote('show','main:another-file.txt'),b'concurrent change')
        source=self.remote('show','main:'+pth)
        self.assertIn('tags: ["AI", "Docker"]',source.decode())
        self.assertEqual(p.digest(source),saved['sha256'])
        self.assertEqual(self.remote('diff-tree','--no-commit-id','--name-only','-r','main').decode().strip(),pth)
        self.assertEqual(p.digest(self.remote('show','main^:'+pth)),article['sha256'])
        with patch.object(p.urllib.request,'urlopen',return_value=io.BytesIO(source)):
            self.assertEqual(p.status(saved['id'])['state'],'live')
        with patch.object(p.urllib.request,'urlopen',return_value=io.BytesIO(b'old article')):
            self.assertEqual(p.status(saved['id'])['state'],'deploying')

    def test_same_message_expired_or_negative_confirmation_cannot_save(self):
        _,_,preview,confirmation=self.prepare(); head=self.remote('rev-parse','main')
        for text in ['不要上传','可以了，但先别上传','上传之后再看看','先改第三段','文章中写着可以了','']:
            with self.subTest(text=text),self.assertRaises(ValueError):
                p.confirm_edit({**confirmation,'confirmation_text':text})
        with self.assertRaisesRegex(ValueError,'NEW user message'):
            p.confirm_edit({**confirmation,'confirmation_message_id':'om_edit_1'})
        with patch.object(p.time,'time',return_value=preview['expires_at']+1):
            with self.assertRaisesRegex(ValueError,'expired'):
                p.confirm_edit(confirmation)
        self.assertEqual(self.remote('rev-parse','main'),head)
        for text in ['可以了','上传','上传吧','可以了，上传','保存吧','请保存这版','确认修改']:
            self.assertTrue(p.edit_confirmation(text),text)

    def test_article_changed_or_deleted_cannot_be_overwritten(self):
        article,payload,_,confirmation=self.prepare()
        self.change('public/markdown/'+article['id']+'.md',b'new remote article')
        head=self.remote('rev-parse','main')
        with self.assertRaisesRegex(ValueError,'changed after preview'):
            p.confirm_edit(confirmation)
        with self.assertRaisesRegex(ValueError,'changed since reading'):
            p.prepare_edit({**payload,'message_id':'om_next'})
        self.assertEqual(self.remote('rev-parse','main'),head)
        preview=p.prepare_delete({'article_id':article['id'],'message_id':'om_delete'})
        p.confirm_delete({'request_id':preview['request_id'],'confirmation_message_id':'om_confirm_delete','confirmation_text':preview['confirmation_text']})
        head=self.remote('rev-parse','main')
        with self.assertRaisesRegex(ValueError,'not found'):
            p.confirm_edit(confirmation)
        self.assertEqual(self.remote('rev-parse','main'),head)

    def test_preview_is_idempotent_but_cannot_mutate_same_revision(self):
        _,payload,preview,_=self.prepare()
        self.assertEqual(p.prepare_edit(payload),preview)
        with self.assertRaisesRegex(ValueError,'another draft'):
            p.prepare_edit({**payload,'body':'unseen replacement'})
        p.prepare_edit({**payload,'message_id':'om_next','body':'newest draft'})
        with self.assertRaisesRegex(ValueError,'no longer current'):
            p.prepare_edit(payload)

    def test_retry_cannot_overwrite_later_article_revision(self):
        article,_,_,confirmation=self.prepare(); job=p.confirm_edit(confirmation)
        head=self.remote('rev-parse','main')
        self.assertEqual(p.confirm_edit(confirmation),job)
        self.assertEqual(self.remote('rev-parse','main'),head)
        self.change('public/markdown/'+article['id']+'.md',b'later revision')
        head=self.remote('rev-parse','main')
        self.assertEqual(p.confirm_edit(confirmation),job)
        self.assertEqual(self.remote('rev-parse','main'),head)

    def test_crash_after_push_recovers_without_another_commit(self):
        _,_,_,confirmation=self.prepare()
        with patch.object(p,'complete_edit',side_effect=RuntimeError('simulated crash')):
            with self.assertRaises(RuntimeError): p.confirm_edit(confirmation)
        head=self.remote('rev-parse','main')
        self.assertEqual(p.confirm_edit(confirmation)['state'],'submitted')
        self.assertEqual(self.remote('rev-parse','main'),head)

    def test_ambiguous_success_and_failed_push_do_not_blindly_overwrite(self):
        _,_,_,confirmation=self.prepare(); original=p.git
        def fail(*args,**kwargs):
            if args[0]=='push': return subprocess.CompletedProcess([],1,b'',b'network down')
            return original(*args,**kwargs)
        head=self.remote('rev-parse','main')
        with patch.object(p,'git',side_effect=fail):
            with self.assertRaises(RuntimeError): p.confirm_edit(confirmation)
        with self.assertRaisesRegex(ValueError,'uncertain'):
            p.confirm_edit(confirmation)
        self.assertEqual(self.remote('rev-parse','main'),head)
        old=json.loads((p.DATA/'edits'/(confirmation['draft_id']+'.json')).read_text())
        # Simulate an acknowledged-late push of the exact prepared commit.
        original('push','origin',old['commit']+':refs/heads/main')
        self.assertEqual(p.confirm_edit(confirmation)['state'],'submitted')

    def test_metadata_surgery_retains_unrelated_fields(self):
        self.assertEqual(p.header_value('summary:\ncategory: tech', 'summary'), '')
        header='title: old\ndate: 2025-08-14\nsummary: |\n  old summary\n  continued\ncategory: tech\ntags:\n  - js\ncustom:\n  nested: keep\nupdated_at: old'
        out=p.set_header_value(header,'summary','new: "summary"')
        out=p.set_header_value(out,'updated_at','2026-09-17T10:00:00+08:00')
        self.assertIn('tags:\n  - js\ncustom:\n  nested: keep',out)
        self.assertIn('date: 2025-08-14',out)
        self.assertNotIn('continued',out)
        self.assertEqual(p.header_value(out,'summary'),'new: "summary"')
        self.assertEqual(out.count('updated_at:'),1)

    def test_paths_credentials_and_noop_are_rejected(self):
        article,payload,_,_=self.prepare()
        for change in [{'article_id':'../../x'}, {'expected_sha256':'bad'}, {'path':'x'}, {'body':'sk-'+'x'*32}, {'title':'a\nb'}]:
            with self.subTest(change=list(change)),self.assertRaises(ValueError):
                p.prepare_edit({**payload,**change,'message_id':'om_invalid'})
        preview=p.prepare_edit({**payload,'message_id':'om_noop','body':article['body']})
        with self.assertRaisesRegex(ValueError,'No content changes'):
            p.confirm_edit({'draft_id':preview['draft_id'],'confirmation_message_id':'om_ok','confirmation_text':'可以了'})

    def test_search_matches_body_aliases_metadata_and_no_results(self):
        p.publish({**EXAMPLE,'title':'JavaScript 实践','body':'使用 debounce 防止重复调用。','tags':['性能']})
        head=self.remote('rev-parse','main')
        for query in ['防抖函数','DEBOUNCE','性能','JavaScript']:
            result=p.list_articles(query)
            self.assertEqual(result['total'],1,query)
            self.assertEqual(result['articles'][0]['title'],'JavaScript 实践')
            self.assertIn('debounce',result['articles'][0]['excerpt'])
        self.assertEqual(p.list_articles('不存在的文章主题')['total'],0)
        self.assertEqual(self.remote('rev-parse','main'),head)
        self.change('public/markdown/hidden.md',b'---\ntitle: private\ndraft: true\n---\ndebounce')
        self.assertEqual(p.list_articles('debounce')['total'],1)
