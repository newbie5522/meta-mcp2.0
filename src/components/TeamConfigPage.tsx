import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, Save, Users, AlertCircle } from 'lucide-react';

export function TeamConfigPage() {
  const [mappings, setMappings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editedMappings, setEditedMappings] = useState<Record<string, string>>({});

  const fetchMappings = () => {
    setLoading(true);
    axios.get('/api/mappings')
      .then(res => {
        setMappings(res.data);
      })
      .catch(err => {
        console.error("Failed to fetch mappings", err);
        toast.error("获取映射配置失败");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const filteredMappings = mappings.filter(m => 
    m.accountName.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.accountId.includes(searchQuery) ||
    m.store.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.owner.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOwnerChange = (accountId: string, value: string) => {
    setEditedMappings(prev => ({
      ...prev,
      [accountId]: value
    }));
  };

  const handleSave = async () => {
    const payload = Object.keys(editedMappings).map(accountId => {
      const original = mappings.find(m => m.accountId === accountId);
      return {
        ...original,
        owner: editedMappings[accountId]
      };
    });

    if (payload.length === 0) return;

    setSaving(true);
    try {
      const res = await axios.post('/api/mappings/batch', { mappings: payload });
      if (res.data.success) {
        toast.success(`成功更新 ${res.data.count} 项人员配置`);
        setEditedMappings({});
        fetchMappings();
      }
    } catch (err: any) {
      console.error("Save mappings error", err);
      toast.error(err.response?.data?.error || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-1 text-left">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">人员配置与权限映射</h2>
        <p className="text-sm text-slate-500">将团队成员（负责人）分配至对应的广告库与店铺架构。</p>
      </div>

      <Card className="border-slate-200 shadow-sm text-left">
        <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-meta-blue" />
              团队映射矩阵
            </CardTitle>
            <CardDescription className="mt-1">
              批量更新并查阅人员配置的归属。
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="搜索账户/店铺/负责人..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 text-sm border-slate-200 focus:border-meta-blue focus:ring-meta-blue rounded-lg bg-white"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={Object.keys(editedMappings).length === 0 || saving}
              className="h-9 px-4 bg-meta-blue hover:bg-meta-blue/90 text-white font-medium shadow-sm transition-all text-sm rounded-lg"
            >
              {saving ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin"/> 配置中</>
              ) : (
                <><Save className="w-3.5 h-3.5 mr-1.5"/> 保存变更 ({Object.keys(editedMappings).length})</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-[#f9fafb]">
              <TableRow className="hover:bg-transparent border-b-slate-200">
                <TableHead className="font-bold text-slate-700 h-11 border-r border-[#eaebed]">关联店铺</TableHead>
                <TableHead className="font-bold text-slate-700 h-11 border-r border-[#eaebed]">广告账户名称</TableHead>
                <TableHead className="font-bold text-slate-700 h-11 border-r border-[#eaebed]">账户 ID</TableHead>
                <TableHead className="font-bold text-slate-700 h-11 border-r border-[#eaebed]">项目级</TableHead>
                <TableHead className="font-bold text-slate-900 h-11 bg-slate-100 flex items-center justify-between border-b-0 w-[200px]">
                  负责人 (Owner)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-meta-blue" />
                    <p className="mt-2 text-sm text-slate-500">正在拉取系统映射网格...</p>
                  </TableCell>
                </TableRow>
              ) : filteredMappings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center text-slate-500">
                    <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                    未找到相关的配置数据，请先进入店铺管理页面绑定广告账户。
                  </TableCell>
                </TableRow>
              ) : (
                filteredMappings.map((item) => (
                  <TableRow key={item.accountId} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium text-slate-900 border-r border-slate-100 p-3">
                      {item.store}
                    </TableCell>
                    <TableCell className="text-slate-700 border-r border-slate-100 p-3">
                      {item.accountName}
                    </TableCell>
                    <TableCell className="text-slate-500 font-mono text-xs border-r border-slate-100 p-3">
                      {item.accountId}
                    </TableCell>
                    <TableCell className="text-slate-600 border-r border-slate-100 p-3">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                        {item.project}
                      </span>
                    </TableCell>
                    <TableCell className="p-2 w-[200px]">
                      <Input
                        value={editedMappings[item.accountId] !== undefined ? editedMappings[item.accountId] : item.owner}
                        onChange={(e) => handleOwnerChange(item.accountId, e.target.value)}
                        className={`h-8 text-sm ${editedMappings[item.accountId] !== undefined && editedMappings[item.accountId] !== item.owner ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500 bg-amber-50/30' : 'border-slate-200 focus:border-meta-blue focus:ring-meta-blue bg-white'}`}
                        placeholder="输入人名"
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
