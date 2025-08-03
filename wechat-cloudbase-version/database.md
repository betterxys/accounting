# 数据库设计

## 集合：transactions（交易记录）

### 字段结构
```json
{
  "_id": "记录ID（自动生成）",
  "userId": "用户openid",
  "description": "交易描述",
  "amount": 100.50,
  "type": "income|expense",
  "category": "分类名称",
  "date": "2024-01-01",
  "createdAt": "创建时间",
  "updatedAt": "更新时间"
}
```

### 索引建议
1. userId（用于查询用户的交易记录）
2. userId + date（用于按日期范围查询）
3. userId + type（用于按类型统计）

### 权限设置
- 读权限：仅创建者可读
- 写权限：仅创建者可写

### 数据库安全规则
```json
{
  "read": "auth.openid == resource.userId",
  "write": "auth.openid == resource.userId"
}
```